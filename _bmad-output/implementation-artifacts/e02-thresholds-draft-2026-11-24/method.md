# The M-2..M-5 threshold derivation — issue #2167 phase 1 (2026-11-24)

The PROPOSAL package for the consolidated M-1..M-5 signature. Everything
here is a draft for the operator's decision — nothing is signed, no bound
enters the shipped registry, and the derived artifact carries
`signed: false`. Phase 2 (the orchestrator's) carries the package to the
operator for ONE consolidated signature; at the signature the same artifact
moves to `signed: true` and the partial-order gate opens.

## Basis

| input | identity |
|---|---|
| the FINAL A reference | `_bmad-output/implementation-artifacts/e01-final-reference-2026-11-24/` (issue #2162, MR !1072) — corpus `f82298c0852a39c8…`, set `cb371f1a67d7…` (67 cases), the reference manifest the draft artifact binds to |
| the judged pass | `judge-m23-e2167.py` over the capture's 60 ok rows — judge `ibm-granite/granite-4.1-8b` at the venue endpoint, temperature 0, guided JSON; instructions sha256 `d629ff99e6273f3f…` (UNCHANGED from the manifest — the judged set is comparable) |
| the M-4 distribution | the same capture's per-row `wall_ms` (n=60) |

## The judged pass (M-2, M-3)

`judged-results.json` carries the per-case verdicts. The judge settles what
the rows cannot, per the evaluator instructions; the abstention VERDICT
RULES stay mechanical (computed by the script from case class × prose
signal — the LLM never applies the rules).

**The measurement surface, stated plainly (its limitation is the contract).**
The capture records source IDENTITIES (document names/ids + scores), not the
document bodies. The M-2 verdict is therefore an ATTRIBUTION trace: a claim
is grounded when the answer attributes it to a recorded source by name or
unambiguous reference. A claim that paraphrases a source's content without
naming it reads ungrounded on this surface. The surface is CONTENT-BLIND and
STRICT — a lower bound on grounding, not the full semantics. The B/C legs'
rows carry the same shape (doc-level identities), so the same surface applies
to both legs and comparisons stay valid; the M-2 bound derived below binds
THIS surface, nothing wider.

### M-2 measured (grounding, the substantive-answer population)

| verdict | n=45 substantive answers | rate |
|---|---|---|
| grounded | 12 | 0.267 |
| partial | 1 | 0.022 |
| ungrounded | 32 | 0.711 |
| **ungrounded + partial** | **33** | **0.733** |

The 15 refusal-prose rows are excluded from the M-2 rate (grounding an
unavailability statement is not meaningful on this surface); one of them
(`e01g-unans-sr0999`) was judged "grounded" — recorded, excluded, noise
documented.

**The headline finding for the operator: config A's attributed-grounding is
weak** — 73.3% of its substantive answers carry at least one load-bearing
claim with no trace to a recorded source. The legacy path names its sources
rarely; the B/C legs' citation-verification mechanism (the grounding judge at
finalize) is exactly the surface this bound will judge harder.

**Proposed bound**: `ungrounded_or_partial_rate <= 0.80` — the measured
0.733 plus ~0.07 margin, the M-1 pattern (a line the reference satisfies
that a later run must keep satisfying). A bound this wide constrains little
on config A — it is the honest floor the measured reference supports, and
the B-vs-C comparison carries the sharper signal.

### M-3 measured (abstention correctness, mechanical rules)

| verdict | n | reading |
|---|---|---|
| correct_abstention | 4 | ALL 4 unanswerable cases answered with honest refusal prose — 100% honest on the unanswerable class |
| no_abstention | 44 | answerable-class rows with substantive answers |
| excessive_abstention | 10 | answerable-class rows answered with refusal prose |
| failure_terminal_masked | 1 | `e01-fail-saturation` — config A answered where a typed failure belongs |
| cancellation_terminal_masked | 1 | `e01-cancel-checklist` — config A answered where a cancellation belongs |

- excessive_abstention_rate = 10/54 = **0.185** of the abstention-decidable
  answerable-class population. The 10 rows are ALL restricted-visibility
  cases (`e01g-ans-*` whose sources live in the restricted graph config A
  does not serve) — their refusal is CORRECT for config A's actual reach and
  excessive only against the full-system expectation. The bound tolerates
  that construction on the A reference while still catching a later leg
  abstaining on ordinary answerable cases.
- unanswerable_honest_abstention_rate = 4/4 = **1.000**.

**Proposed bounds**: `excessive_abstention_rate <= 0.25` (measured 0.185 +
margin);
`unanswerable_honest_abstention_rate >= 0.95` (measured 1.000, the M-1
floor pattern).

### Observations the judged pass surfaced (recorded, not scored)

1. **Injection-fixture content reaches non-security answers on config A.**
   `e01-ans-restricted-contents` and `e01-fail-saturation` recount the
   injection fixtures' hostile content (the "instruction-override" /
   "Dredging authorised" markers — the fixtures live in `GRAPH_SOURCE`,
   which the legacy path serves). Config A has no agent surface to judge
   injection resistance (the 7 security scenarios are skipped on A by
   design); these two rows are recorded as M-2 ungrounded and as
   observations. The B/C verdict's security surface is where a leak FAILS
   for real.
2. The masked terminals (failure/cancellation) are the failure and
   cancellation rules' findings on config A, recorded as measured facts —
   the bounded-execution and rollback evidence (V06/V08) covers the agent
   path's own behavior on those classes.

## M-4 (latency) — derived from the measured distribution

The FINAL A reference's per-row `wall_ms`, n=60 (the protocol layer,
sequential capture — the e01 report names the surface asymmetry; the bound
binds each leg's own recorded `wall_ms`, never a cross-leg comparison):

| stat | ms |
|---|---|
| min | 3620.5 |
| median | 5944.7 |
| p90 | 8016.1 |
| p95 | 8498.2 |
| max | 10512.5 |

**Proposed bound**: `wall_ms <= 15000` per case. Derivation: the measured
maximum (10512.5 ms) plus ~43% headroom for shared-GPU jitter, stated at a
clean number; cross-checked against the issue #2118 reference's own max
(11443 ms over its 9 answered cases — the two references' maxima sit in the
same band, so the headroom is not sized on one lucky run).

## M-5 (resource consumption) — the honest bound is the deployment's own ceiling

**No measured distribution exists to derive from**: the FINAL A reference
records no resource surface at all (documented in the S4 exit checklist),
and the capture rows carry no usage records. Inventing a number here would
be exactly the default the protocol forbids ("the value is never invented").

**Proposed bound**: `total_tokens_per_case <= the deployment's configured
AGENT_RUN_MAX_TOTAL_TOKENS ceiling`. The enforcement path already refuses to
run unbounded (the budget knobs are REQUIRED, fail-closed — no numeric
default exists anywhere), so the signed rule states the real contract:
per-case served token consumption (prompt + completion, from the B/C rows'
usage records) must stay inside the ceiling the deployment itself declares.
The bound's NUMBER is the venue deployment's knob value at the B/C campaign;
until the number is concrete the bound reads UNINTERPRETABLE in the report
grammar — it BLOCKS the dimension, it never passes silently. At signature
time the operator reads the deployment's knob and either signs the concrete
number or keeps M-5 absent (an absence keeps the gate closed — the operator's
call, with this package as the argument for the ceiling rule).

## The floor-scope recommendation (the analysis the dispatch asked for)

**Recommendation: NOT APPLICABLE records — do NOT sign bounds scoped to the
B/C doc-level surface for M-1.**

1. The signed M-1 bounds bind config A's chunk-level anchor surface — the
   registry's own scope note says the surfaces "differ by construction
   (pair E01), so the threshold applies per surface and never across them".
   The e02 layer acts on that scope: a bound scoped to another configuration
   is recorded NOT APPLICABLE — "neither is applied, neither is a pass".
2. Signing new doc-level bounds today would put numbers where no measurement
   exists: the doc-level surface has NO measured reference (the A reference
   is chunk-level; the B/C legs have not run — the gate blocks them). PRD §8
   forbids exactly that: a threshold needs a measured basis, and "a
   signature never manufactures a pass for a dimension nobody agreed a
   threshold for".
3. The regression signal on the B/C legs does not need re-labeled M-1
   bounds: this package's M-2/M-3/M-4/M-5 bounds apply to both legs'
   surfaces, the e02 verdict compares B vs C per dimension (a coverage below
   the fixed pipeline's is a measured regression), and the coexistence
   criterion covers the legacy path under load. The chunk-level M-1 floors
   keep protecting the legacy path on the E01 pair.
4. Cost/risk of the alternative (B/C-scoped M-1 bounds now): invented
   numbers (protocol violation), a required doc-level reference that cannot
   exist before the gated legs run (circular), and a bound that would either
   mask regressions or fail everything. KISS verdict: the NOT APPLICABLE
   records plus the signed M-2..M-5 carry the verdict; doc-level bounds
   become signable AFTER the first gated B measurement exists (the same
   partial order, one level deeper).

## What the package is NOT

- Not signed: `sign_off.signed: false` in the draft registry; the derived
  artifact carries `signed: false` (the shape the gate refuses — by design).
- Not the shipped registry: `protocol/thresholds.yaml` is untouched by this
  phase; the draft lives in this directory.
- Not a gate key: `run_protocol.py thresholds` over the draft registry
  REFUSES to derive a signed artifact while the sign-off is unsigned — the
  refusal record is kept as the evidence that the protocol's order held.
