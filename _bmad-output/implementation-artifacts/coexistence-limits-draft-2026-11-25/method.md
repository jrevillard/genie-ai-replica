# The coexistence criterion's legacy limits — the DRAFT derivation (#2146, 2026-11-25)

The PROPOSAL package for NFR-3's legacy limits (issue #2146, blocker 2's
buildable half). Everything here is a draft for the operator's decision —
nothing is agreed, no verdict opens on it: the artifact carries
`status: "draft"` and the coexistence harness REFUSES a draft artifact
outright (`draft_limits`), so the criterion's verdict stays BLOCKED until
the operator agrees. The harness applies limits, it never authors or
defaults them — this package is the authoring, and the agreement act is the
operator's: flip the `status` key of `legacy-limits.draft.json` (the JSON
artifact beside this method note — NOT this markdown file) to `"agreed"`,
with the decision recorded on the issue, then pass that JSON as
`run_protocol.py coexistence --limits`. Nothing in the harness needs to
change for the agreement to take effect.

## Why the legacy path's limits derive from the A references

The coexistence criterion bounds the LEGACY path (config A is the legacy
fixed RAG — the pair manifests say so, and the criterion compares the
legacy path alone against the legacy path under concurrent agentic load).
The legacy path's own measured record IS the FINAL A reference: the same
capture the signed M-4 latency band derives from, on the same corpus, the
same assessment set, the same venue. The #2118 reference (the first A
measurement, one day earlier, pre-outage-fix) is the cross-check that the
numbers are not one run's luck.

Basis identity (both carried in the draft artifact so a future live run's
lineage check binds it):

| input | identity |
|---|---|
| the FINAL A reference | `_bmad-output/implementation-artifacts/e01-final-reference-2026-11-24/` (issue #2162, MR !1072) — corpus `f82298c0852a39c8…`, assessment set `cb371f1a67d7…` |
| the #2118 reference | `_bmad-output/implementation-artifacts/e01-run-2026-11-23-forge/` (issue #2118, MR !1056) — the cross-check |
| the signed M-4 ceiling | `tests/rag-benchmarks/protocol/thresholds.yaml` — `wall_ms <= 15000`, signed 2026-11-24 (issue #2167) |

## The measured distribution (the FINAL A reference, OK population)

The capture records 68 rows: 60 executed legacy requests (`status: ok`)
and 8 config-A-skipped security rows (`wall_ms: 0.0` placeholders — never
sent on config A, not legacy requests, excluded from every denominator
here; the criterion's own request mix on the venue excludes them the same
way). The 60 OK rows, nearest-rank percentiles (the harness's own rule,
`coexistence._percentile`):

| stat | ms |
|---|---|
| min | 3620.5 |
| median | 5944.7 |
| p90 | 7977.2 |
| p95 | 8491.7 |
| max | 10512.5 |

error_rate 0/60 = **0.0**; availability 60/60 = **1.0**.

The #2118 cross-check (9 answered of 17 attempted — the remainder failed
into the documented venue-outage condition, a venue property recorded in
that run's report, not a legacy-path property, and not an availability
basis): min 5850.3, median 8931.7, p95 = max 11443.2.

Cross-reference spreads (the run-to-run / venue-to-venue band):

| metric | FINAL A | #2118 | spread |
|---|---|---|---|
| median | 5944.7 | 8931.7 | 2987.0 |
| p95 | 8491.7 | 11443.2 | 2951.5 |
| max | 10512.5 | 11443.2 | 930.7 |

## The proposed absolute limits

| limit | proposal | derivation |
|---|---|---|
| `latency_median_ms <= 12000` | the worse measured median (8931.7, #2118) plus ~34% margin, at a clean number; below the signed per-case ceiling |
| `latency_p95_ms <= 15000` | the signed M-4 ceiling — the operator's already-agreed per-request wall-time line for this deployment; both references sit inside it (worst measured p95 11443.2) |
| `latency_max_ms <= 15000` | the same signed M-4 ceiling (worst measured max 11443.2) — one number, one home, already signed |
| `error_rate <= 0.05` | the rule of three: zero failures in 60 requests puts the 95% confidence upper bound at ≈ 3/60 = 0.05 |
| `availability >= 0.95` | the error bound's complement, stated in the availability's own polarity |

The latency pattern is the M-1/M-4 pattern: a line the references satisfy
that a later run must keep satisfying. The median limit is the sensitive
early-warning line (it sits below every measured maximum); the p95/max
limits inherit the signed per-case ceiling rather than inventing a second
number for the same quantity.

## The proposed regression tolerances (the control → loaded delta)

The criterion's own question — did the legacy path degrade under the
agentic load? — is scored against these. Each derives from a measured
band, not a guess:

| tolerance | proposal | derivation |
|---|---|---|
| `latency_median_ms` | `max_delta 3000` | the cross-reference median spread (2987.0) rounded up — a loaded-phase median degradation past the measured run-to-run band is degradation, not noise |
| `latency_p95_ms` | `max_delta 3000` | the cross-reference p95 spread (2951.5) rounded up, same reasoning |
| `latency_max_ms` | `max_delta 4500` | the signed M-4 jitter headroom in ms (15000 − 10512.5 = 4487.5) rounded up — the headroom the operator already signed for shared-GPU jitter, applied to the tail |
| `error_rate` | `max_delta 0.05` | the absolute error bound's own width — added failures beyond 5 percentage points fail |
| `availability` | `max_delta 0.05` | the complement, in the availability's polarity |

## What the package is NOT

- Not agreed: `status: "draft"`; the harness's status vocabulary is
  `draft → agreed` and it refuses ANY status that is present and not
  `agreed` (typed refusal reason `unagreed_limits`, case-insensitive on the
  flip) — a typo'd agreement never opens a verdict. The verdict stays
  BLOCKED — the blocker 2 state — until the operator flips the status.
- Not signed anywhere: `thresholds.yaml` is untouched (the M-4 ceiling is
  REFERENCED, never edited); the signed thresholds registry's sign-off is
  not this artifact's home.
- Not measured under load: the tolerances derive from cross-run spread
  between two references, not from repeated control/loaded pairs — that
  measurement is the live comparison itself, which needs the agreed limits
  first (the order the partial order imposes). The draft says so; a
  post-run revision can tighten any bound from the live phases' own
  numbers.
- Not a substitute for the lineage check: the artifact carries the corpus
  fingerprint and the assessment-set digest it was derived against; a live
  run against another corpus refuses it (`limits_lineage_mismatch`), as
  the harness already does.
