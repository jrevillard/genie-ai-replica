# ADR okf-015: In-app authoring & curation (Markdown editor + repo/bundle CRUD)

- **Status**: Accepted
- **Date**: 2026-07-16
- **Decision owners**: Jerome Revillard, Genie.ai Dev

## Context
Users need tools to **create OKF repositories and curate the Markdown concept files** — in production, web-only (Flutter has no ingestion/admin UI; confirmed).

## Decision
Provide **in-app authoring/curation** in the Vue 3 admin dashboard:
- A **Markdown concept editor**: frontmatter form (`type` required + `title`/`description`/`resource`/`tags` plus the optional v0.2 families `generated`/`verified`/`status`/`stale_after`/`sources` — [ADR-okf-017](okf-017-okf-v02-trust-lifecycle-provenance.md)) + Markdown body editor (reuse `marked`/`DOMPurify`) + **link picker** (from the repository's concept tree) + **live OKF §11 validation** + PII pre-check.
- Full **repository/bundle management**: CRUD, lifecycle (register→validate→review→approve→publish→version→deprecate→retire), ACL, retention, version diff, FOI audit export.

External Git/S3 ingest remains a parallel path. A **local validator/linter CLI** (reuse `okf-conformance`, MIT) supports bulk external authoring.

## Alternatives considered
| Alternative | Status |
|---|---|
| External-only authoring (Git/producer) | Rejected — the user requires in-app curation of the Markdown. |
| Standalone editor application | Rejected — extend the existing admin dashboard (consistency, shared auth/i18n). |

## Consequences
- **Positive**: full in-app curation; external tooling optional; reuses existing UI/i18n patterns.
- **Negative**: editor complexity.
- **Mitigations**: reuse `marked`/`DOMPurify`; link picker from the concept tree; live §11 validation guides authors.

## References
Production spec §5.2, §7; ADR-okf-007 (expanded); [ADR-okf-017](okf-017-okf-v02-trust-lifecycle-provenance.md).
