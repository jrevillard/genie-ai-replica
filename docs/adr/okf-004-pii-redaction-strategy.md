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

## Revision (2026-08-14) — Presidio in a first-party Python sidecar, called from Node

**Context.** The original decision ("Presidio library mode in the OKF Server `governance/` module") is not implementable as written: Presidio is Python-only and the OKF Server is Node (ADR-okf-001); no Presidio code exists in the repo. A Node-native rule-based (regex) scanner was considered as the v1 gate but rejected as the AUTHORITATIVE mechanism: GDPR "personal data" extends far beyond structured identifiers — names, addresses, dates of birth, and health/financial facts in free prose are personal data, are undetectable by regex, and are precisely what the target deployments ingest. NER-based detection is required at the gate. Product decision (2026-08-14): a dedicated Presidio container is acceptable and preferred.

**Decision.**

1. **New first-party service: `components/pii-service/`** (Python/FastAPI + `presidio-analyzer` + `presidio-anonymizer` + a spaCy NER model baked into the image). MIT/Apache-2.0 only; model-in-image → air-gap sovereign (NFR-S1); CPU-only (NFR-S6); internal service behind Kong (like dataprep — not publicly routed); CI build/scan/promote lane mirroring the existing components. Bump-UNgated (imports nothing from OPEA `comps`).
2. **Node client, fail-closed.** The OKF Server's `governance` module calls `POST /v1/pii/scan` (`{text, entities?}` → `{hits[{type,start,end,score}], counts_by_type, redacted_text}`) via `services/pii/pii-client.js` (timeout/retry/circuit). Sidecar unavailable → `pii_state='error'` → publish blocked (FR-5/NFR-P1). **No silent fallback at the authoritative gate.**
3. **Rule-based scanner demoted to advisory pre-check.** A regex detector remains in Node ONLY for the in-editor PII pre-check (FR-25) where instant feedback matters and a miss is cosmetic; the ingest/publish gate is Presidio-only.
4. **Per-jurisdiction recognizer registry.** National-ID formats (Lesotho, Bangladesh, Gambia, …) are configuration entries in the sidecar's Presidio recognizer registry — not code changes.
5. **Redaction + original retention.** Strategy = replace-with-typed-placeholder (`[PII:PERSON]`) preserving readability. The unredacted original is the access-controlled retained document-repository copy (FR-27/ADR-okf-016) — steward review needs no separate encrypted store. okf-server persists only type/count/masked-preview summaries (NFR-P2: never raw PII).

## Alternatives considered (revision)

| Alternative | Status |
|---|---|
| Node-native regex/rule scanner as the gate | **Rejected** — cannot detect prose personal data (names/addresses/DoB/health facts); a silent miss at the gate is a compliance failure, not lower recall. Retained only as the editor's advisory pre-check. |
| Node ML PII libraries | Rejected — no mature, permissively-licensed, offline NER PII stack in Node comparable to Presidio. |
| PII detection at query/serving time | Rejected (unchanged from original) — leaks PII into the index/embeddings. |
| External PII SaaS | Rejected (unchanged) — sovereignty. |
