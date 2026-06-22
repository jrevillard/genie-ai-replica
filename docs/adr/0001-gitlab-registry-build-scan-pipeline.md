# ADR 0001: GitLab Container Registry build + scan + promote pipeline

- **Status**: Accepted
- **Date**: 2026-06-22
- **Decision owners**: Jerome Revillard (architect), BMAD party-mode review (Winston / Amelia / Murat)

## Context

GENIE.AI ships 16 custom Docker images (frontend, backend, db-migrations,
document-repository, nginx, kong-config, 6 OPEA AI/ML services, postgres-init,
keycloak, keycloak-config, tempo-proxy). Until this change, those images were
built and pushed only to a **local Swarm registry** (`localhost:5000`) by Ansible
during deploy (`deploy/ansible/deploy.yml:501-538`). GitLab CI built the
frontend image ephemerally for E2E tests (`.gitlab-ci.yml:131`) but never
published anything.

The project's GitLab instance (`opensource.unicc.org`, **17.5.2-ee**, project ID
90) has the Container Registry feature enabled at
`registry.opensource.unicc.org` (was empty before this change). We want every
MR / `main` commit / tag to publish all 16 images, scanned, to the GitLab
registry — and progressively retire the local Swarm registry.

### Constraints

- **CI runner is non-privileged.** The existing comment at
  `.gitlab-ci.yml:130` ("DOCKER_BUILDKIT=0 avoids privileged-mode requirement
  on CI runners") documented a real 2024 constraint: BuildKit (default), DinD,
  and buildx docker-container driver all require privileged mode.
- **Self-hosted GitLab** — `opensource.unicc.org` is not a trusted OIDC issuer
  for public Sigstore Fulcio.
- **Sovereign public-sector project** — roots of trust should be self-owned.
- E2E jobs run **only on merge trains** (`$CI_MERGE_REQUEST_EVENT_TYPE == "merge_train"`).

## Decision

Implement a 3-stage pipeline — `build` → `scan` → `promote` — using 2026
supply-chain best practices. Signing is deferred to phase 2.

### 1. Builder: BuildKit rootless

Use `moby/buildkit:rootless` with `buildctl-daemonless.sh` and
`BUILDKITD_FLAGS: --oci-worker-no-process-sandbox`. Per GitLab's official docs
(docs.gitlab.com/ci/docker/using_buildkit), BuildKit rootless is the
**designated Kaniko replacement** and works on non-privileged runners with no
docker daemon and no privileged container. This supersedes the 2024-era
`DOCKER_BUILDKIT=0` workaround.

**Cache**: BuildKit registry cache backend (`--cache-to/--cache-from
type=registry,ref=…/cache,mode=max`) — a dedicated cache image holding all
intermediate layers. Far more effective than classic `--cache-from`, which
pulls the full image each build.

### 2. Flow: scan-before-publish with digest promotion

```
build:image → :pending-<sha> (main/tag) or :mr-<iid>-<sha> (MR)
     ↓
scan:image → Syft SBOM + Trivy gate (HIGH/CRITICAL fixable) + DB freshness gate
     ↓
[e2e:integration on merge trains — pulls candidate, runs --no-build]
     ↓
promote:image → retag immutable DIGEST → :main / :main-<sha> / :<vX.Y.Z> / :latest
              → delete :pending-<sha>
```

- Vulnerable images never reach a deployable tag — they sit under the
  quarantine `:pending-<sha>` tag, which no deployment references and which is
  deleted after successful promotion.
- Promotion is by **immutable digest**, never by the mutable pending tag. The
  exact bytes that were scanned are the bytes that get deployed.
- E2E pulls the candidate from the registry (`docker compose pull` + `up
  --no-build`) instead of rebuilding locally — tests validate the exact
  artifact that would be promoted.

### 3. Promote ordering and the merge-train design

`promote` runs only on `main` and tags. E2E jobs run only on merge trains, so
promote on `main`/tag is gated by `scan` (stage ordering) and by the
**merge-train e2e having already validated the merged content** — the standard
GitLab merge-train guarantee. Code does not reach `main` without passing the
train's e2e.

### 4. SBOM: Syft, 1-year retention

Syft generates `sbom.spdx.json` (SPDX 3.0 JSON) — higher quality than Trivy's
built-in SBOM. Retained as a CI artifact for 1 year (EU Cyber Resilience Act
audit horizon). Trivy scans the same image; phase 2 will attach the SBOM to the
image via `cosign attest`.

### 5. Signing: deferred to phase 2

Cosign signing is **not** in this MR. Rationale: a signature nobody verifies is
ceremony. Signing lands together with `cosign verify` at deploy time (Ansible),
in phase 2, so the signature is enforced — not decorative.

When phase 2 lands, the choice is **cosign key-based** (not keyless):
- Self-hosted GitLab is not a trusted OIDC issuer for public Sigstore Fulcio →
  keyless requires a self-hosted Sigstore stack (Fulcio + Rekor + CT log + TUF),
  a separate infrastructure initiative.
- Key-based achieves **SLSA L2** (signed provenance) with zero infrastructure.
- The private key lives in GitLab CI as a protected+masked variable; the public
  key is committed at `configs/cosign/cosign.pub` for deploy-time verification.
- Transparency log upload disabled (`--tlog-upload=false`) for sovereignty.

### 6. Trivy gate governance

The blocking gate is `trivy image --severity HIGH,CRITICAL --ignore-unfixed
--exit-code 1 --ignorefile .trivyignore`. Unfixable CVEs are filtered
automatically; fixable exceptions are governed via `.trivyignore`, where every
entry must reference a ticket and is reviewed quarterly.

## Alternatives considered

| Alternative | Rejected because |
|-------------|------------------|
| Kaniko | Deprecated; Google no longer actively develops it. BuildKit rootless is the GitLab-blessed replacement. |
| DinD + `docker buildx` | Requires privileged runner. BuildKit rootless removes that constraint. |
| Classic `docker build` (`DOCKER_BUILDKIT=0`) | Works (the 2024 workaround) but gives up BuildKit features: multi-stage caching, registry cache backend, concurrent stage resolution. |
| Build → push → scan | Anti-pattern: publishes vulnerable images to deployable tags before scanning. |
| Build → scan local tar → push (Pattern D) | Image tarballs (100 MB–1 GB × 16) exceed GitLab artifact limits. |
| Cosign keyless now | Requires self-hosted Sigstore stack — separate infra initiative, out of scope. |

## Consequences

- **Positive**: 16 images published per pipeline; vulnerable images quarantined;
  SBOM artifacts for audit; deployable tags always point at scanned digests;
  local Swarm registry can be retired in phase 3.
- **Negative**: pipeline adds 3 stages of wall-clock time (build + scan +
  promote) per MR; BuildKit rootless adds a learning curve vs classic docker
  build; `needs:matrix` requires GitLab ≥15.9 (verified: 17.5.2-ee).
- **Mitigations**: BuildKit registry cache reduces rebuild cost after warm-up;
  matrix parallelizes the 16 images; interruptible: true on build/scan lets
  newer pipelines cancel stale ones.

## Phasing

- **This MR (phase 1)**: build + scan + SBOM + e2e-against-candidate + promote.
- **Phase 2a**: cosign sign stage (between e2e and promote) + SBOM attestation +
  `cosign verify` in promote before retag.
- **Phase 2b**: Ansible pulls from GitLab registry + `cosign verify` before
  `docker pull` at deploy.
- **Phase 3**: retire the local Swarm registry.
- **Phase 4 (sovereignty upgrade)**: self-hosted Sigstore for keyless
  identity-based signing (SLSA L3).

## References

- GitLab BuildKit docs: https://docs.gitlab.com/ci/docker/using_buildkit/
- GitLab Docker layer caching: https://docs.gitlab.com/ci/docker/docker_layer_caching/
- SBOM + Container Signing on GitLab CI (2026): https://www.bitslovers.com/sbom-supply-chain-security-gitlab-ci/
- SLSA framework: https://slsa.dev/
- Plan file: `/home/jerome/.claude/plans/snuggly-noodling-flamingo.md`
