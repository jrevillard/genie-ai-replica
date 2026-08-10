# ADR okf-017: OKF v0.2 — embrace trust, lifecycle & provenance; defer Attested Computation

- **Status**: Proposed
- **Date**: 2026-08-10
- **Decision owners**: Genie.ai Dev (architect)

## Context

The OKF spec advanced from **v0.1 (June 2026)** to **v0.2 (August 2026)**. v0.2 is a **minor** bump: the permissive conformance baseline is unchanged (parseable frontmatter + non-empty `type` + reserved-filename structure), the bundle/repository/graph model is unchanged, and every change is either two deliberate field renames or new **optional** frontmatter families. A v0.1 bundle remains consumable by a v0.2 reader via documented fallbacks. This ADR records how the GENIE OKF Server targets v0.2 and which families it consumes, derives, surfaces, authors, and defers.

The production spec was drafted against v0.1; with v0.2 published, the server now targets v0.2.

### What v0.2 changed (§13 of the spec)

- **Breaking renames (consumers MAY fall back to the v0.1 form):**
  - `timestamp` → **`generated.at`** (a concept's last content change is now `generated: { by, at }`).
  - Body **`# Citations` list → frontmatter `sources`** (provenance moves into frontmatter).
- **Additive optional families (absence yields a plain v0.1 concept):**
  - **Trust**: `generated` (who/what produced it) + `verified` list → derives a **trust tier** (unverified / machine-confirmed / human-reviewed).
  - **Lifecycle**: `status` (`draft` | `stable` | `deprecated`) and `stale_after` (absolute `YYYY-MM-DD`).
  - **Provenance**: `sources` with per-source credibility signals (`author`, `usage_count`, `last_modified`) + `usage_window`.
  - **Attested Computation** (new concept type): sanctioned, attestable computations (`runtime`/`parameters`/`executor`/`attester`).
  - **Actor convention**: `agent/tool`, `human:`, `process:` for `generated.by` / `verified[].by`.
- **Conformance section renumbered** from v0.1 §9 to v0.2 §11 (rule unchanged).

## Decision

**Target OKF v0.2. Embrace the trust, lifecycle, and provenance families as first-class in a government knowledge layer; consume the two renames with fallbacks; defer Attested Computation.**

1. **Target v0.2.** New repositories declare `okf_version: "0.2"` (root `index.md`); the OKF Server stores the bundle's declared format version on the repository record. v0.1 bundles remain consumable via the v0.2 fallbacks. **No migration of existing content** — none has been authored yet; the el-salvador pilot bundles are authored in v0.2 form from the start.

2. **Consume the two renames.** The OKF parser ([ADR-okf-010](okf-010-okf-markdown-loader-location.md)) reads `generated.at` for last-content-change (falling back to legacy `timestamp` when `generated` is absent) and reads frontmatter `sources` for provenance (falling back to a legacy body `# Citations` list for v0.1 documents). Both fallbacks are non-breaking.

3. **Embrace trust / lifecycle / provenance** — these map directly onto GENIE's governance model and are the strongest reason v0.2 fits a sovereign government use case:
   - **Trust**: derive a **trust tier** from `verified` — `unverified` (no `verified`) / `machine-confirmed` (non-`human:` actors only) / `human-reviewed` (any `human:` actor). A steward's **publish sign-off is written as a portable `verified: { by: human:<steward>, at: <date> }`** — a consumer-readable trust signal, not merely an internal OKF-Server lifecycle flag.
   - **Lifecycle**: `status` aligns with the curation lifecycle (draft → stable → deprecated); **`stale_after`** drives automatic staleness detection (`today ≥ stale_after` ⇒ stale) — essential for government knowledge that expires (regulations change, seasonal agriculture advisories lapse).
   - **Provenance**: `sources` with per-source credibility signals answers "where did this knowledge come from" — essential for FOI/GDPR accountability and audit.
   The parser **preserves all families** into concept metadata; serving **surfaces** trust tier + staleness + source provenance alongside concept content (PRD **FR-29**) so agents can weight and disclose provenance.

4. **Author the families in-app.** The concept editor ([ADR-okf-015](okf-015-in-app-authoring-curation.md)) authors the v0.2 families: `generated` (default `by` = the human author), `verified` (stamped on steward publish), `status`, `stale_after`, and `sources`. Fields are optional; the editor guides but does not force them.

5. **Conformance = v0.2 §11** (renumbered from v0.1 §9). Baseline rule unchanged. The validator **additionally warns** on malformed families (bad actor prefix, invalid `status` enum, unparseable `stale_after`, `sources` entries missing `resource`) — non-blocking, surfaced in the conformance report (PRD FR-13).

6. **Defer Attested Computation** (`type: Attested Computation` with `runtime`/`parameters`/`executor`/`attester`) to a future phase. It is niche relative to OKF Server v1: sanctioned, attestable computations are relevant to government metrics/reporting but are not core to governed knowledge *serving*, and the v0.2 spec itself defers the full runtime protocol (receipt/verdict wire formats, attester ABI/sandboxing). The parser treats its fields as **opaque pass-through** (preserved, not interpreted); it is tracked as an open question (PRD §13), not built.

7. **Unknown producer keys** are preserved (not rejected), per v0.2 §4.1 — the server never drops unrecognized frontmatter on round-trip.

## Alternatives considered

| Alternative | Status |
|---|---|
| Target v0.1 / ignore v0.2 | Rejected — loses provenance/trust/lifecycle, which are the government-knowledge value-add; v0.1 is superseded. |
| Build Attested Computation in v1 | Rejected — niche; its runtime protocol is explicitly deferred by the v0.2 spec; not governed-knowledge-serving scope. |
| Treat all families as opaque pass-through only | Rejected for trust/lifecycle/provenance — deriving a trust tier + staleness is the point. Opaque pass-through **is** the policy for Attested Computation fields and any unknown producer keys. |

## Consequences

- **Positive**: government-aligned trust/lifecycle/provenance become first-class; v0.1 content still works (fallbacks); the conformance baseline is unchanged, so existing validation logic stays valid.
- **Negative**: the authoring editor and serving responses are richer; the parser must handle two field forms (`generated.at` + legacy `timestamp`; `sources` + legacy `# Citations`).
- **Mitigations**: the fallback reads are trivial; every family is optional, so absence yields a plain concept that is still served.

## References

OKF v0.2 SPEC §4.1, §5, §7, §10, §11, §13; PRD §1, §3, §6, §12, §13, FR-4, FR-25, **FR-29**; [ADR-okf-010](okf-010-okf-markdown-loader-location.md); [ADR-okf-015](okf-015-in-app-authoring-curation.md).
