# ADR okf-009: Performance/freshness targets and supply-chain CI

- **Status**: Proposed
- **Date**: 2026-07-15
- **Decision owners**: Genie.ai Dev (architect); confirm targets with stakeholders

## Context

The PRD names NFR-PR1/PR2 and SM-1 with placeholder values; supply-chain integrity must follow ADR-0001. This ADR pins concrete targets and the CI posture.

### Constraints

- CPU-only nodes; no GPU; reuse retriever hybrid path; sovereign.

## Decision

**Performance/freshness targets (v1, configurable):**
- Search p95 latency ≤ **300 ms** for a reference bundle size on `genieai=true` CPU nodes (NFR-PR1).
- Bundle-to-agent freshness ≤ **15 min** from source change to queryable (SM-1), configurable per source (poll interval / webhook).
- Per-response token cap default **4–8k tokens**, configurable; `okf_get_doc` slices on request (NFR-PR2).

**Supply-chain CI:** the `okf-server` image goes through the ADR-0001 **build → scan → promote** pipeline (`tmp/` quarantine → CycloneDX SBOM retained 1 yr → container-scanning blocking MR gate → promote by digest); non-root CPU image; phase-2 cosign signing + deploy-time verify.

## Alternatives considered

| Alternative | Status |
|---|---|
| Looser latency (e.g., 1s) | Rejected — agent UX degrades; 300 ms is achievable via reused retriever on CPU. |
| Webhook-only freshness (no poll) | Rejected as sole path — sources may not support webhooks; poll is the baseline. |
| Custom CI gate (not ADR-0001) | Rejected — reuse the established pipeline; consistency + supply-chain integrity. |

## Consequences

- **Positive**: clear SLOs; consistent supply chain; auditable.
- **Negative**: 300 ms p95 may require tuning (ArangoSearch view, index choices) as corpus grows.
- **Mitigations**: ArangoSearch approx vector path (retriever default); performance tests in CI; configurable caps.

## References

- PRD SM-1, NFR-PR1/PR2, NFR-S5; ADR-0001; Architecture §10–11.
