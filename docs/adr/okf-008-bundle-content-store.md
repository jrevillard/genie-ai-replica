# ADR okf-008: Bundle content store — reuse document-repository (storage + ClamAV + dataprep handoff)

- **Status**: Accepted
- **Date**: 2026-07-15
- **Decision owners**: Jerome Revillard (architect), Genie.ai Dev

## Context

OKF bundle bytes need persistent storage, virus scanning, and a path into dataprep. The document-repository already provides disk storage + ArangoDB `files` + ClamAV (`securityService.scanBuffer`) + a dataprep handoff — but its pipeline rejects archives (extension allowlist, magic-byte validator, mandatory English langdetect, single-base64 contract).

### Constraints

- Minimize vendors; reuse existing components; complement (not duplicate) document-repository.

## Decision

**Reuse the document-repository as the bundle content + scan + handoff backend**, extended with a **new bundle-aware route** (`/api/files/ingest-bundle`) that accepts archives/directories, reuses `securityService.scanBuffer` (ClamAV), and writes concept docs — **bypassing** text-extraction/langdetect/single-base64. The OKF Server owns bundle registry/curation/serving; the document-repository owns bytes + scan + handoff; ArangoDB (`OKF_*`) owns the indexed knowledge.

## Alternatives considered

| Alternative | Status |
|---|---|
| OKF Server manages its own content store (disk/object) | Rejected — duplicates storage/scanning; diverges from "one document repository." (Documented; revisit if bundle-native storage proves cleaner.) |
| Store bundle bytes in ArangoDB directly | Rejected — ArangoDB is for indexed knowledge, not large blob storage. |

## Consequences

- **Positive**: single document repository; reuses ClamAV + storage + handoff; no new vendor.
- **Negative**: document-repository gets a new route; its upload-oriented model doesn't fit bundles natively (route bypasses most of its pipeline).
- **Mitigations**: clearly scoped bundle route; reuse only storage + scan + handoff.

## References

- PRD §10; Architecture §2, §6.1; decision log (doc-repo decision).
