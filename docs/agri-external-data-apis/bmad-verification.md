# BMAD Verification — Red Team + Pre-Mortem

**Date:** 2026-09-17 · **Target:** [research-findings.md](research-findings.md) · [data-availability-matrix.md](data-availability-matrix.md) · [remediation-plan.md](remediation-plan.md)
**Methods:** Red Team vs Blue Team (#21, attack → hardening) · Pre-mortem Analysis (#57, failure → causes → prevention)

## Verdict

**PASS with hardening applied.** The research findings survived adversarial review unmodified (every source claim was live-probed; no attack falsified a verified fact). The remediation plan had **8 defects** — all in design completeness, none fatal — which are now fixed in the plan. Residual risks are documented below; nothing blocks implementation.

## Red Team — attacks and hardening applied

| # | Attack | Result | Hardening applied |
|---|---|---|---|
| 1 | **Regional data mistaken for local prices** — Nicaraguan egg / Guatemala City wholesale prices fed to the LLM as the farmer's local price → confidently wrong advice. The most dangerous failure mode of the whole design | **CONFIRMED defect** — envelope had `coverage` but nothing mandated prompt injection or inline labels | §4 correctness mandate: prompt builders must inject coverage + market type + source labels; charts render source inline per series |
| 2 | Fresh deployment, empty Redis/Arango, scheduler not yet run → all dialogs empty for hours; stakeholders see "broken" | **CONFIRMED defect** — seeds were client-side only | §5: idempotent startup seed import into Arango; phase 8 cold-start smoke test |
| 3 | Swarm replicas each run the scheduler → duplicate GDELT calls → sticky limiter throttles the deployment IP; news picker dies | **CONFIRMED defect** | §5: single-flight scheduler with distributed (Redis) lock per adapter |
| 4 | "Serve stale + trigger background refresh" on the request path contradicts "upstreams only in scheduler" — request-path stampede possible | **CONFIRMED wording defect** | §5 unified: requests only *nudge* the scheduler |
| 5 | Health check validates HTTP 200 but upstreams change schema silently (HDX adds column, preview API path shifts) → green health, garbage data | **CONFIRMED defect** | §3: health validates schema/parse success; alert thresholds per source type (monthly > 45 d, news > 6 h, NDVI > 10 dekads, annual > 15 mo) with routing to ops channel |
| 6 | Quiet news weekend + hard 48 h window → empty picker reads as broken | **CONFIRMED defect** | §7: < 3 items in 48 h → widen to 7 d with visible dates |
| 7 | WFP unit drift 45→46 kg quintal creates ~2.2 % step artifact; NIC/GT files carry local-currency `price` alongside `usdprice` | **CONFIRMED defect** | §6 normalization: `usdprice` column, USD/kg canonical, quintal render; trend min-3-points rule |
| 8 | Honey: FAOSTAT producer price (2022) spliced with Comtrade export UV (2025) = two semantics in one line | **CONFIRMED defect** | §6: two labeled segments, never spliced |
| 9 | Multi-replica double-fetch of Comtrade violating 1 req/s | covered by #3 | — |
| 10 | RSS/XML feeds are third-party content (compromised/malformed feed → parser issues) | valid | §5: entity-resolution disabled, 5 MB payload caps |
| 11 | localStorage quota exhaustion over months | valid, low | §5: last-response-per-endpoint only, < 500 KB budget, versioned schema keys |
| 12 | Gateway-level caching of public data (optimization, not defect) | noted | not applied — defer to implementation |
| 13 | Comtrade monthly variant returns 0 rows (agent-verified) — daily attempt wasted | minor | noted: annual-only attempt is fine |

## Pre-mortem — "It's December, the feature was reverted." Causes & preventions

| # | Cause of failure | Prevention (now in plan) |
|---|---|---|
| 1 | AI advice contradicts visible reality (attack #1) | §4 mandate + inline labels |
| 2 | GDELT IP blacklist from replica stampede (attack #3) | single-flight lock + health alert |
| 3 | Cold-start emptiness (attack #2) | startup seed import + smoke test |
| 4 | WFP SLV dataset silently stops (like Honduras 2022) | 45-day staleness alert; staples degrade to GT/NIC lines |
| 5 | "Numbers don't match my market" — SS wholesale ≠ rural farm-gate | market-type scope label in dialog + prompts |
| 6 | Phase-7 deletion leaves a dangling import; CI breaks late | removal in one commit + full lint/test gate |
| 7 | Comtrade preview API tightened/quashed | droppable adapter; degradation order; quarterly watch |
| 8 | Mobile cache schema drift breaks old LKG reads | versioned cache keys, TTL-clean on read |

## Findings NOT applied (deliberate)

- **Gateway response caching for anonymous seed data** — an optimization, not a correctness issue; revisit at implementation.
- **Comtrade monthly probing** — harmless daily 0-row response; revisit only if we need monthly import parity.

## Residual risks accepted

- FAOSTAT API revival timeline unknown (bulk zips are the designed channel; FAO contact follow-up is open decision #4).
- IPPC POARS is the only credible future path to real regional pest alerts — quarterly watch, no dependency.
- iNaturalist will stay sparse — labeled "community sightings," by design.
