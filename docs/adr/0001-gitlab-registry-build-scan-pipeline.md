# ADR 0001: GitLab Container Registry build + scan + promote pipeline

- **Status**: Accepted (amended 2026-07-31)
- **Date**: 2026-06-22
- **Decision owners**: Jerome Revillard (architect), BMAD party-mode review (Winston / Amelia / Murat)
- **Last amended**: 2026-07-31 — promote job rewrites scan report image names (§6.1)

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
              → report saved as gl-scan-tmp.json (NOT ingested — see §6.1)
     ↓
[e2e:integration on merge trains — pulls tmp/ candidate, runs --no-build]
     ↓
promote:image → cross-repo copy tmp/<image>@DIGEST → <image>:main / :main-<sha> / :vX.Y.Z / :latest
              → delete tmp/<image>:<candidat>
              → sed rewrite tmp/<image>:* → <image>:<tag> in gl-scan-tmp.json
              → publish gl-container-scanning-report.json (ingested — see §6.1)
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

### 4. SBOM: CycloneDX (from the GitLab template)

The GitLab Container Scanning template (`gtcs scan`) produces a CycloneDX SBOM
(`gl-sbom-*.cdx.json`) per image, retained as a CI artifact for 1 year (EU CRA
audit horizon). Phase 2 attaches it to the image via `cosign attest`.

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

### 6. Scanning: Custom Trivy template + promote-stage report rewrite

Scanning uses a **custom `.scan_template`** (Trivy 0.57.0, no GitLab official
Container Scanning template). The scan stage does two passes per image:

1. **Trivy JSON** (`--exit-code 0`): advisory, outputs `gl-scan-tmp.json`
   (saved as a CI artifact, NOT ingested into the vulnerability report).
2. **Trivy table** (`--exit-code 1 --ignore-unfixed --severity HIGH,CRITICAL`):
   gating — fails the pipeline if fixable HIGH/CRITICAL CVEs exist.

**Blocking** on HIGH/CRITICAL is at the scan stage (pre-promote gate). Findings
are NOT sent to the GitLab vulnerability report from this stage (see §6.1).

The GitLab official Container Scanning template is intentionally NOT used because:

- It auto-publishes the report under tmp/ image names → orphaned findings when
  images are deleted (3,339 findings documented in CVE remediation 2026-07-30).
- We need to control WHEN and under WHAT NAME the report enters the
  vulnerability database — only after promote, with persistent image names.

#### 6.1 Promote-stage report rewrite (added 2026-07-31)

The promote job downloads `gl-scan-tmp.json` from the scan stage, rewrites image
names with `sed`, and publishes the result as `gl-container-scanning-report.json`
with `artifacts:reports:container_scanning`. This is the ONLY point where
container scanning findings enter the GitLab vulnerability report.

```
Scan:   trivy --output gl-scan-tmp.json   → artifacts:paths (no reports:)
Promote: sed tmp/NAME:tag → NAME:main      → artifacts:reports:container_scanning
         > gl-container-scanning-report.json
```

**Why rewrite instead of re-scan**: promote copies by digest — the bytes are
identical. The same scan result is valid; only the name changes. Rewriting in
the promote job costs zero scan time and zero registry pulls.

**Why `:main` (mutable tag)**: findings tracked against mutable tags (`:main`,
`:latest`) auto-resolve across rebuilds — re-scanning the same tag after a fix
shows the CVE gone, and GitLab flips the finding state. Digest-keyed tracking
would re-orphan on every promote (same disease, new shape).

**Regex** (tested on real Trivy JSON artifact from pipeline #5590):
```
sed "s|tmp/${IMAGE_NAME}:[^\"() ]*|${IMAGE_NAME}:${CI_COMMIT_BRANCH:-main}|g"
```

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
  vulnerability report tracks persistent image names (no orphaned findings);
  auto-resolution works across rebuilds; local Swarm registry can be retired in phase 3.
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
no CI job, no token. Applied on project 90 via the UI
(Settings → CI/CD → Container Registry → Cleanup policies):

- `enabled`: true
- `cadence`: `1d` (runs daily)
- `keep_n`: 5 (keep the 5 most recent matching tags per image, safety net)
- `name_regex` (delete): `.*` (every tag is a deletion candidate)
- `name_regex_keep`: `main.*|latest|v.*|release.*`
- `older_than`: `7d`

**Regex anchoring**: GitLab wraps keep/remove patterns with `\A...\Z`, so each
must match the **full** tag name. `main.*` catches `main` + `main-<sha>`;
`release.*` catches `release-el-salvador` + `release-el-salvador-<sha>` (NOT
`release-*`, which in regex means `release` + zero-or-more hyphens — a trap).
`cache` is intentionally NOT kept: the build cache tag is rewritten on every
build, so active images keep fresh cache automatically; cache for an image not
built in 7d is stale and safe to reap (self-healing on next build).

Effect: any tag not matching the keep-regex and older than 7d is deleted, in
**both** namespaces. Deployable tags (`main`/`main-<sha>`/`latest`/`vX.Y.Z`/
`release-*`) match keep → preserved. Candidate tags (`pending-*`/`mr-*`) and
stale `:cache` → reaped after 7d. The real namespace only ever holds deployable
tags. `release.*` in the keep-regex is **critical** once release-branch image
tags exist — without it the policy would purge release rolling tags.
