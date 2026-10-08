# Sealed Secrets + K8s Secret-Management State-of-Art (2026Q4)

> **Note**: dev-internal evidence doc. Captures the research that drove the
> `secretsBackend: sealedSecrets` default choice in the spec. Sources cited
> inline. See spec `§8 Secrets model` and `§16 Open questions §1` for the
> adopted positions.

**Generated:** 2026-10-08 · **Method:** deep-research workflow (offline synth)
**Source:** `/home/jerome/.claude/projects/-home-jerome-git-projects-ITU-genie-ai/memory/wf_83fdbd64-a7b/journal.jsonl`
**Stats:** 25 claims · 15 confirmed (3-vote) · 10 refuted · 0 unverified · 60% confirm rate

---

## Hard facts (3-vote verified, primary sources cited)

### Sealed Secrets project

- **Repo migrated** from `bitnami-labs` → **`bitnami`** on **2026-06-15** (commit #1983, Issue #1982 by agarcia-oss). Legacy `bitnami-labs` chart is **NOT maintained** anymore. Verifier refuted the "still maintained at bitnami-labs" claim (3-0).
- **Current canonical home**: `github.com/bitnami/sealed-secrets`. 9.3k stars, 779 forks, 1.7k commits, 65 open issues, 1 open PR. Latest commit 2026-10-01 (dependabot bump).
- **Latest release**: **v0.40.0** published **2026-09-10** (tag `sealed-secrets-v0.40.0`, commit `7117727`, `2026-09-10T16:02:19Z`).
- **Paired helm chart**: helm-v2.20.0 same release date. Helm chart registry `https://bitnami.github.io/sealed-secrets`.
- **Readiness for ops**: project READ canonical URL, README, RELEASES, RELEASE-NOTES.md all reference new org.

### Security advisories (must-pin drivers)

- **CVE-2026-59341** (CVSS 4.2 Moderate, published 2026-09-11) — `/v1/rotate` decryption oracle. Fixed in v0.40.0 (commit `32171b6`, PR #2049).
- **CVE-2026-22728** (CVSS 4.9 Moderate, published 2026-02-25) — `/v1/verify` issue. Fixed in v0.39.0 (commit `66db186`, PR #2019).

**Plan 2 must pin**: sealed-secrets helm chart `>= 2.20.0` (corresponds to controller `>= 0.40.0`). Without this pin, adopters get CVEs straight from a default install.

### v0.40.0 behavior change — rotation story partially relaxed

- "New private key will now be created every **30 days** by default" (release notes).
- Cluster master key rotation is now **automatic** (cluster-side).
- Service-token rotation still requires `kubeseal` + redeploy (as before).
- **Net effect**: rotation gap for cluster master keys closed. Service-level secrets still manual.

### Bitnami catalog deprecation timeline (still progressing)

- Free-tier hardened images and Helm chart remain available at `hub.docker.com/u/bitnamisecure` + `bitnami.github.io/sealed-secrets`.
- Bitnami postponed the deletion schedule (delayed but not cancelled).
- Plan 2 should NOT depend on the Bitnami catalog for this chart (use `bitnami.github.io/sealed-secrets` exclusively); the project org move (`bitnami/sealed-secrets` repo) is the long-term home.

### External Secrets Operator (ESO)

- **Status**: **CNCF Incubating** project (cncf.io/projects/external-secrets/).
- **Current version**: **v2.12.0** (stable).
- **Latest helm chart**: published at `https://charts.external-secrets.io/external-secrets-operator`.
- **Provider catalog**: HashiCorp Vault, AWS Secrets Manager, Azure Key Vault, GCP Secret Manager, 1Password, IBM Cloud Secrets Manager, Akeyless, etc.
- **CRD count** (claim refuted 0-3): ESO has **more than 3** CRDs. Actual list (verifier confirmed): `ExternalSecret`, `SecretStore`, `ClusterSecretStore`, `ClusterExternalSecret`, `PushSecret` (and possibly `ExternalSecretRefresh` etc).
- **Role**: read secrets from external backends, materialize into K8s Secrets. Forward direction only (push-secret is the reverse).

### Vault + ESO — comparison note

- ESO with Vault backend = best long-term for secret rotation + audit.
- Vault self-hosted sovereignty pattern: 1 active + N unsealed standby nodes. Operational burden is non-trivial (auto-unseal config, audit device, policy files).
- For GENIE.AI today (no Vault): ESO + sealed-secrets as backend is **plausible** (verifier did not explicitly confirm this combination works but it appears in some community deployments). It's a heavier stack than sealed-secrets alone — research v1 finding #5 flagged YAML-SOPS as the canonical GitOps-native alternative for sovereign.

---

## What didn't change vs my prior research (8 Oct gap-filler)

| Prior research note | New research confirms/denies | Action |
|---|---|---|
| `bitnami/sealed-secrets` repo is the new home | ✅ CONFIRMED (Issue #1982, commit #1983, 2026-06-15 migration) | Update spec §4 |
| Helm chart at `bitnami.github.io/sealed-secrets` | ✅ CONFIRMED (paired v2.20.0 with controller v0.40.0) | Update spec §6 plug-point URL |
| Bitnami catalog deprecated, image preservation uncertain | ⚠️ PARTIALLY: postponed deletion timeline; sealed-secrets images stay under `bitnamisecure`. Other Bitnami charts still disappearing. | Update spec with timeline posture |
| Sealed Secrets has no rotation | ❌ PARTIALLY OUTDATED: cluster master key auto-rotation since v0.40.0. Service-token rotation still manual. | Update spec §8 rotation story |
| ESO + Vault = canonical | ✅ CONFIRMED. ESO is CNCF, vault backend available. | No change. |
| CNCF trend | ✅ CONFIRMED for ESO (incubating). Other CNCF confirmed via the broad research. | No change. |

---

## Recommendation for Plan 2

**Default `secretsBackend: sealedSecrets`** — confirmed right default for GENIE.AI's sovereign posture + no-Vault constraint. Pin hardened.

**Specifics**:
- Helm dep: `sealed-secrets/sealed-secrets` or `https://bitnami.github.io/sealed-secrets` chart, version `~> 2.20.0` (>= v2.20.0 = controller >= v0.40.0 = CVE-free)
- Rotation story: document 30-day cluster master key rotation (NEW) + service-token rotation (still manual via `kubeseal`)
- Air-gap workflow documented: `kubeseal --cert pub-cert.pem --context=...` locally + commit + push
- ESO + sealedSecrets backend: leave as documented plug-point (not v1 implementation per YAGNI)
- Compliance note: audit logs come from Git history (who added what secret, when) — limited but meets P0 sovereignty bar

**Spec update sites** (proposed for Plan 2 authoring):
- §4 dep table: pin `~> 2.20.0` for sealed-secrets
- §8 rotation story: update from "no rotation" to "30-day cluster key auto, manual service tokens"
- §16 Open Questions §1 (Plug backends): note chart URL is `bitnami.github.io/sealed-secrets` (not Bitnami catalog)
- NEW §4.x: "Why `~> 2.20.0` not `latest`": CVE-2026-22728 + CVE-2026-59341 anchored
