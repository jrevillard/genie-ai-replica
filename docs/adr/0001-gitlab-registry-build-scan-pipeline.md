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

- **CI runner is non-privileged**, hardened with a docker-socket-proxy (API
  filtering) on a tcp endpoint. E2E jobs run only on merge trains.
- **Self-hosted GitLab** — `opensource.unicc.org` is not a trusted OIDC issuer
  for public Sigstore Fulcio.
- **Sovereign public-sector project** — roots of trust should be self-owned.

### The userns-remap × buildkit conflict (architectural finding)

The runner originally enabled `userns-remap` on the daemon for UID isolation.
Systematic debugging proved this is **fundamentally incompatible with every
container-based BuildKit mode**:

| BuildKit mode | Blocked by |
|---------------|-----------|
| docker-container driver (buildx default) | privileged container ↔ userns-remap ("privileged mode is incompatible with user namespaces") |
| rootless (standalone) | rootlesskit's nested userns (`newuidmap: write to uid_map failed`) |
| docker driver (in-daemon) | buildx refuses the docker driver on non-local (tcp) endpoints — only unix sockets qualify |

Every avenue was tested empirically (see git history: rootless, security_opt,
docker-container driver-opt, explicit docker context). The triangle
**userns-remap × socket-proxy-tcp × BuildKit features** is impossible — one
constraint must give. The decision (option 1) was to **disable userns-remap**:
it was the only constraint blocking modern BuildKit, and its marginal security
value is low given the socket proxy (API filtering) + dedicated runner VM
already provide isolation.

## Decision

Implement a 3-stage pipeline — `build` → `scan` → `promote` — using 2026
supply-chain best practices. Signing is deferred to phase 2.

### 1. Builder: docker buildx (docker-container BuildKit driver), native

With userns-remap disabled (see above), the buildx **docker-container driver**
runs its privileged BuildKit container without conflict. `build:image` uses
`docker buildx build --push` with the **registry cache backend**
(`--cache-to/--cache-from type=registry,mode=max`) — the modern path: supports
all BuildKit syntax (`--chmod`, `--mount`), multi-platform ready, efficient
layer caching. No `DOCKER_BUILDKIT` env manipulation (the daemon manages
BuildKit, on by default in Docker 23+; runner pinned to 28.x).

### 2. Flow: tmp/ quarantine namespace → scan → promote (digest)

```
build:image  → tmp/<image>:pending-<sha> (main/tag) | tmp/<image>:mr-<iid>-<sha> (MR)
     ↓
scan:image   → Syft SBOM + Trivy gate on tmp/<image>:<candidat>
     ↓
[e2e:integration on merge trains — pulls tmp/ candidate, runs --no-build]
     ↓
promote:image → cross-repo copy tmp/<image>@DIGEST → <image>:main / :main-<sha> / :vX.Y.Z / :latest
              → delete tmp/<image>:<candidat>
```

- Candidates live in a **separate `tmp/` namespace** (`registry.../genie-ai/tmp/<image>`).
  The real namespace (`genie-ai/<image>`) only ever holds deployable tags —
  orphan candidates never pollute it, which matters for registry audit clarity.
- Promotion is a **cross-repo copy by immutable digest** (blob-mount, no
  re-upload). The exact bytes scanned are the bytes deployed.
- E2E pulls the candidate from `tmp/` (`docker compose pull` + `up --no-build`)
  instead of rebuilding locally — tests validate the exact artifact promoted.
- Orphan `tmp/` tags (failed pipelines, abandoned MRs) are reaped by GitLab's
  native cleanup policy — see the last section of this ADR.

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

| Alternative | Status |
|-------------|--------|
| Keep userns-remap + find a working buildkit mode | **Impossible** — proven exhaustively (see conflict table above). |
| Disable userns-remap (chosen) | **Selected** — unblocks docker-container BuildKit; isolation retained via socket proxy + dedicated VM. |
| Disable socket proxy (unix socket direct) | Rejected — loses API filtering; would enable docker-driver BuildKit but weakens security. |
| Legacy builder (`DOCKER_BUILDKIT=0`) + Dockerfile rewrites | Rejected — deprecated builder (debt) + couples app code to infra limits. |
| BuildKit rootless | Rejected — needs nested userns, blocked by userns-remap (now moot since userns disabled, but docker-container is simpler). |
| External BuildKit service (remote driver) | Rejected — extra infra for a configurable limit. |
| Build → push → scan (no quarantine) | Rejected — anti-pattern: unscanned images under deployable tags. |
| Cosign keyless now | Deferred — requires self-hosted Sigstore stack, separate infra initiative. |

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

## Container Registry cleanup policy (replaces a CI purge job)

Candidate images build into a `tmp/` quarantine namespace
(`registry.../genie-ai/tmp/<image>:<candidat>`); promote copies them to the
real namespace. Orphan candidate tags (failed pipelines, abandoned MRs) are
reaped by GitLab's native **Container Registry cleanup policy** — server-side,
no CI job, no token:

- **Settings → CI/CD → Container Registry → Cleanup policies**
- `name_regex_keep`: `main|latest|v.*|cache` (preserve deployable + build cache)
- `older_than`: `24h`
- `enabled`: true

Any tag not matching the keep-regex and older than 24h is deleted, in **both**
namespaces. Real-namespace tags (`main`/`latest`/`vX.Y.Z`) and `:cache` refs
match keep → preserved. Candidate tags (`pending-*`/`mr-*`) → deleted after 24h.
The real namespace therefore only ever holds deployable tags.
