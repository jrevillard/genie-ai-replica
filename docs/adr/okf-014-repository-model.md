# ADR okf-014: Repository model — repository = OKF bundle = one domain

- **Status**: Accepted
- **Date**: 2026-07-16
- **Decision owners**: Jerome Revillard, Genie.ai Dev

## Context
Large corpuses must be broken down by domain into multiple OKF repositories. The relationship between *repository*, *OKF bundle*, and *domain* needed to be fixed (not assumed).

## Decision
**Repository = one OKF bundle = one domain = one graph (`OKF_{repo_id}`).** Domains reuse the **existing service-category hierarchy** (`/api/service-categories` — the admin "Knowledge Hierarchy" tab); a repository is tagged with a domain category. CRUD is at the repository level (the bundle + its concept files). A domain **may hold multiple repositories** (a very large domain can be split into several repositories under the same domain category).

## Alternatives considered
| Alternative | Status |
|---|---|
| Repository contains many bundles | Rejected — adds CRUD + graph complexity. |
| New dedicated domain taxonomy | Rejected — duplicates the existing knowledge hierarchy. |

## Consequences
- **Positive**: simple 1:1:1 model; reuses the hierarchy; clean per-repo graph isolation; **unaffected by OKF v0.2** (the bundle/repository model is unchanged — only optional frontmatter families and two renamed fields changed, see [ADR-okf-017](okf-017-okf-v02-trust-lifecycle-provenance.md)).
- **Negative**: one bundle per repository (a very large domain = one large bundle unless split).
- **Mitigations**: split a large domain into multiple repositories under the same domain category.

## References
Production spec §3.1, §5; ADR-okf-002 (revised).
