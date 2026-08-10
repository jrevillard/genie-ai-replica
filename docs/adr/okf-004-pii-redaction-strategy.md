# ADR okf-004: PII redaction strategy — Presidio at ingest, document-level default, blocking

- **Status**: Proposed
- **Date**: 2026-07-15
- **Decision owners**: Genie.ai Dev (architect); confirm with DPO

## Context

OKF bundles are authored externally (Git/S3) and may contain PII. Genie mandates PII redaction on every external data path, with BLOCK on failure (NFR-P1). OKF §11 conformance must remain permissive (best-effort). The question is *where* and *how* to redact.

### Constraints

- Must not corrupt OKF conformance (redaction ≠ rejection of non-conforming-but-PII-free bundles).
- Blocking behavior on PII policy failure (withhold from `published`).
- Permissive library (Presidio, MIT); no new infra.

## Decision

Run **Microsoft Presidio (library mode)** at **ingest**, in the OKF Server `governance/` module, on each concept's body (and tagged sensitive frontmatter fields). Default to **document-level redaction** (mask/tokenize detected PII entities in the stored text). **PII policy failure is blocking**: affected concepts are withheld from `published` and flagged for steward review. Conformance (§11) remains a non-blocking quality gate, independent of PII.

## Alternatives considered

| Alternative | Status |
|---|---|
| Field-level redaction only (frontmatter) | Rejected as default — bodies carry most PII; field-only misses prose PII. (Available as opt-in for tagged fields.) |
| Redact at query/serving time | Rejected — leaks PII into the index/embeddings; violates data minimization. |
| External PII service / SaaS | Rejected — sovereignty; new vendor. |

## Consequences

- **Positive**: PII never reaches embeddings/audit; clear blocking semantics; sovereign (in-process library).
- **Negative**: redaction can alter concept text (masking) — may affect search fidelity; Presidio model adds CPU cost at ingest.
- **Mitigations**: preserve original (encrypted/separate) for steward review where policy requires; tune Presidio recognizers per tenant; ingest is async (cost off the query path).

## References

- PRD FR-5, NFR-P1/P2/P3; Architecture §8.
