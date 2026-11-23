---
title: 'Story 4.4 — Thresholds and counter-metrics'
type: 'feature'
created: '2026-11-23'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '820fc9d75b605f0a831f866089450f895cc6647d'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-genie-ai-2026-11-16/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — the issue #1980 acceptance criteria, operator-authored">

## Intent

**Problem:** The partial-order gate (story 4.1) refuses a gated B/C run unless a SIGNED thresholds file exists for the measured reference — but nothing in the repo says where the agreed thresholds live, who signs them, or what happens while they are not agreed: the numbers have no home (PRD OQ-5, §8), and CM-1/CM-2/CM-3 have no reporting surface, so an agentic gain could be published without the cost, the abstention and the limit hits that make it honest.

**Approach:** Add the threshold registry to the protocol package — a versioned YAML registry (`protocol/thresholds.yaml`) with one entry per measured dimension (M-1..M-5), each entry either an agreed value or an EXPLICIT absence, plus the surface it applies to, the rationale, the agreement date and the sign-off owner; a loader/validator that refuses to treat an absent dimension as satisfied and blocks promotion on a missing or unsigned sign-off; and a counter-metrics report whose first-class entries are CM-1 (cost and latency per agentic request vs the RAG reference — the delta visible, not averaged away), CM-2 (excessive-abstention rate on questions the reference answers correctly) and CM-3 (rate of executions hitting limits/cancellation).

**Operator decisions (2026-11-23):** the registry lives in the protocol package (`tests/rag-benchmarks/protocol/thresholds.yaml`); the gate sign-off owner is the operator, **jrevillard (ITU)**, recorded in the registry header and exposed in the report; a missing or unsigned sign-off blocks promotion exactly like an absent threshold; until the measured reference lands (issue #2118 — the E01 live run on the forge k3s) EVERY dimension ships as explicitly absent with its reason — absence blocks promotion and never defaults to a value. The threshold NUMBERS are agreed post-baseline (PRD §8) in a separate follow-up, not in this story.

## Boundaries & Constraints

**Always:**
- The registry is the single home of the threshold decision: one entry per measured dimension (M-1..M-5), each either an agreed value or an explicit absence — never a missing entry, never an implicit default, never a value the loader invented.
- An absent dimension BLOCKS promotion: the validator never treats absence as satisfied, never substitutes a value, never reports an absent dimension as passing.
- A missing or unsigned sign-off blocks promotion like an absent threshold; the sign-off owner is recorded in the registry header and exposed in the report.
- The thresholds artifact the partial-order gate verifies is DERIVED from the registry (registry content + reference lineage), never authored independently.
- CM-1/CM-2/CM-3 are first-class results: top-level entries in the counter-metrics report, each with its measurement surface, values and availability — never a side note inside another dimension's record.
- CM-1's delta stays visible: per-request deltas and their distribution are recorded; one averaged number never stands in for the delta.
- Absent inputs are recorded as absent WITH their reason (a missing reference-correctness ledger, a configuration with no cost surface) — never as a zero, never silently dropped.
- Every input is digested into the report's inputs record; the report is a pure function of its inputs plus a pinned `created_utc`.

**Never:**
- No threshold NUMBER is invented here: every dimension ships as explicitly absent (the measured reference is pending issue #2118); the agreed values land in a separate follow-up MR.
- No change to the gate's typed refusals (`missing_reference`, `missing_thresholds`, `thresholds_not_signed`, `thresholds_lineage_mismatch`), to the E01/E02 refusal classes, or to the harness identity (`harness_sha`) surfaces — this story adds surfaces around them, never edits them.
- No change under `eval/` or `capture_baseline.py`.
- No eager third-party import in the package: the registry loader imports PyYAML lazily, so every other command keeps working on a venue node without it (the package's stdlib-only invariant).
- No judging in code: CM-2's reference-correctness denominator comes from a lineage-verified campaign artifact (the judge layer's output), never from a heuristic invented here.
- No deployment corpus content authored: fixture rows only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| thresholds, shipped registry | every dimension absent | every dimension reported absent with its reason; promotion blocked; no value read | N/A |
| thresholds, sign-off unsigned | agreed values but `signed: false` | promotion blocked on the sign-off, naming the owner | N/A |
| thresholds, sign-off owner missing | registry header without an owner | promotion blocked (sign-off missing) | typed refusal |
| thresholds, dimension entry missing | registry without the M-3 entry | refused — the registry is incomplete | typed refusal |
| thresholds, malformed YAML | unparsable registry file | refused, naming the file | typed refusal |
| thresholds, sign a blocked registry | registry not complete | NO signed artifact is produced; the report records the blocking reasons | typed refusal (exit 1) |
| thresholds, sign a complete registry | all dimensions agreed + signed | a gate-compatible signed thresholds file is produced, carrying the lineage | N/A |
| counters, CM-1 both surfaces present | reference rows + candidate rows with `wall_ms` | CM-1 records per-request latency deltas, their distribution and the agentic cost surface | N/A |
| counters, CM-1 reference without cost surface | reference rows carry no token counts | the cost side is recorded as unavailable WITH its reason; the latency delta is still reported | N/A |
| counters, CM-2 correctness ledger absent | no reference-correctness artifact | CM-2 recorded as not computable with its reason — the rate is NOT reported as 0 | N/A |
| counters, CM-2 ledger present | ledger lists the reference-correct case ids | CM-2 = the candidate's abstentions on those cases ÷ those cases; both counts in the record | N/A |
| counters, CM-3 limit/cancellation hits | candidate rows with `budget_exhausted` / `cancelled` terminal states | CM-3 records the rate plus the per-case terminal states | N/A |
| counters, CM-3 no hit | every execution answered | CM-3 rate 0 with the execution count | N/A |

</frozen-after-approval>

## Code Map

**Reuse (do not reinvent):**
- `tests/rag-benchmarks/protocol/gate.py` — `thresholds_file()` (:72-93), the gate-compatible thresholds artifact shape (`artifact`, `signed`, `corpus_fingerprint`, `assessment_set_sha256`, `reference_manifest_sha256`, `thresholds`); `is_thresholds_file()` (:68-69); `check_gated_run()` (:95-157) — READ ONLY, its refusal vocabulary is untouched.
- `tests/rag-benchmarks/protocol/manifest.py` — `sha256_json` (:70-73), `manifest_digest` (:175), `redact` (:76), `build_manifest` (:112).
- `tests/rag-benchmarks/protocol/e01.py` — the report precedents: `M_DIMENSIONS` (:72-78), `_surface_record` (:516-526) (surface / available / values / not_available_reason / notes), `HONEST_EVIDENCE_STATEMENT` (:80-89), the reference-defects ledger pattern (a lineage-verified campaign artifact: `reference_defects_file` :264, `verify_defects_lineage` :289), `e01_report_digest`.
- `tests/rag-benchmarks/protocol/findings.py` — the versioned-artifact header + digest pattern (`report_digest`, `build_findings_report`).
- `tests/rag-benchmarks/protocol/drivers.py` — the row vocabulary: config-B rows (`case_id`, `status`, `answer`, `abstained`, `abstention_reason`, `source_documents`, `metadata`, `wall_ms`), config-C rows (`outcome`, `run_id`, `wall_ms`, `usage_record`, `cancel_requested`, `cancelled`, `error_text`), the outcome constants (:661-668).
- `tests/rag-benchmarks/protocol/run_protocol.py` — the CLI conventions: argparse subparsers with `set_defaults(func=cmd_*)` (`build_parser` :510-582), `main()` mapping typed refusals → exit 1 and usage → exit 2 (:585-599), `_write_manifest(out_dir, name, obj)` (:148-155) for out-dir writes, the `e01`/`verdicts` commands writing to an explicit `--out` path (:371, :475), and `check_gated_run` called from `cmd_assess` (:271-279).
- `components/agent-service/agent/orchestrator.py` — `RunUsageRecord` (:225-260): the agentic cost surface (`model_calls`, `aux_model_calls`, `tool_calls`, `prompt_tokens`, `completion_tokens`, `wall_clock_seconds`, `outcome`); `agent/loop.py` :67-68 — the `budget_exhausted` / `cancelled` terminal outcomes CM-3 counts.

**Facts (not to re-derive):**
- The gate never reads the thresholds' NUMBERS — it verifies presence, integrity and lineage only; the numbers are this story's decision surface.
- The gate accepts a thresholds file only when `signed` is true; an unsigned one is refused as `thresholds_not_signed`.
- The gate scans EVERY `*.json` in the run out-dir (`gate.py` :115-126) and routes by `artifact` — a derived thresholds artifact written into that out-dir is exactly what the gate will find.
- The A reference rows carry no resource fields (no tokens, no cost) and the anchor's per-query rows carry no timing — only the protocol-layer `capture-a` rows carry `wall_ms` for A.
- B rows carry `wall_ms` and the mechanical abstention fields (`abstained`, `abstention_reason`); C rows carry `wall_ms`, `outcome` and the `usage_record`.
- CM-3's limit marker: config C carries `usage_record.outcome == "budget_exhausted"` and `outcome == "cancelled"`; config B has only `abstention_reason == "result_budget_exhausted"` or an untyped failure row; config A has no limit/cancellation surface at all.
- CM-2's denominator is NOT in any protocol artifact: "the reference answers correctly" is a judge-layer fact, so it must arrive as a lineage-verified campaign artifact — its absence is recorded, never defaulted.
- `manifest_digest` hashes the WHOLE manifest, `created_utc` included — a report built from the same inputs needs the same pin to digest equal.
- The harness identity (`harness_sha`) hashes ONLY the pinned `eval/` scripts (`capture_baseline.EVAL_IDENTITY_FILES`) — files added under `protocol/` leave it unchanged.
- PyYAML is already installed by the `test:rag-benchmarks` CI job (`.gitlab-ci.yml` pip line) — the registry loader needs no new dependency; its import is LAZY (inside the loader), so the package stays importable — and stdlib-only — without PyYAML, and the venue-side commands keep working.
- The protocol suite's conventions: plain pytest, function-style tests, no `conftest.py`, imports like `from protocol import gate` (the suite runs from `tests/rag-benchmarks`), typed refusals asserted through `pytest.raises` + `failed.value.reason`, CLI exercised both by a hand-built `argparse.Namespace` and through `main(argv)` for the exit-code path.
- The measured reference is still being produced (issue #2118 — the E01 live run on the forge k3s); no threshold value exists yet.

## Tasks & Acceptance

**Execution:**
- [x] `tests/rag-benchmarks/protocol/thresholds.yaml` -- NEW: the versioned registry (header + one entry per M-1..M-5, every dimension explicitly absent with its reason, the sign-off owner `jrevillard (ITU)` recorded, unsigned) -- the single home of the threshold decision (OQ-5).
- [x] `tests/rag-benchmarks/protocol/thresholds.py` -- NEW: the loader/validator (strict registry shape, per-dimension status, the promotion decision that refuses to treat an absent dimension as satisfied and blocks on a missing/unsigned sign-off) + the derivation of the gate-compatible thresholds artifact FROM the registry -- the machinery that enforces PRD §8.
- [x] `tests/rag-benchmarks/protocol/counter_metrics.py` -- NEW: CM-1 (per-request cost/latency delta vs the reference, delta visible), CM-2 (excessive abstention on reference-correct questions, denominator from a lineage-verified artifact), CM-3 (limit/cancellation rate) as first-class records, with unavailable surfaces recorded with their reason -- the honest counter-metric surface.
- [x] `tests/rag-benchmarks/protocol/run_protocol.py` -- `thresholds` and `counters` subcommands (typed refusal → exit 1; the thresholds command refuses to emit a signed artifact while the registry is incomplete) -- the CLI surface of both halves.
- [x] `tests/rag-benchmarks/test_protocol_thresholds.py` -- NEW: every registry/promotion row of the matrix through fixtures (temp registries, fake reference manifests) -- the registry's contract is executable.
- [x] `tests/rag-benchmarks/test_protocol_counter_metrics.py` -- NEW: every counter-metric row of the matrix through fixture rows (reference/candidate rows, correctness ledger, limit/cancellation terminals) -- the counter-metrics' contract is executable.
- [x] `.gitlab-ci.yml` -- the protocol pytest line gains the two new test files -- the new suites run in CI.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- the story entry to `review` (at completion).

**Acceptance Criteria:**
- Given the shipped registry, when it is loaded, then every measured dimension (M-1..M-5) is reported with an agreed value OR an explicit absence and its reason, and the promotion decision is BLOCKED — an absent dimension is never reported as satisfied and no value is defaulted (PRD §8, issue #1980 AC 1).
- Given the registry header, when the report is built, then the gate sign-off owner is exposed (`jrevillard (ITU)`), and a missing or unsigned sign-off blocks promotion exactly like an absent threshold (issue #1980 AC 3, OQ-5).
- Given the counter-metrics report, when it is read, then CM-1, CM-2 and CM-3 are first-class results — top-level entries with their measurement surface, values and availability — and CM-1's delta is visible per request rather than collapsed into one average (issue #1980 AC 2).
- Given a reference-correctness ledger that is absent, when CM-2 is computed, then it is recorded as not computable with its reason — the rate is never reported as zero (PRD §8, absence is explicit).
- Given the same inputs and a pinned `created_utc`, when the counter-metrics report is rebuilt, then its digest is identical.

## Implementation Notes

**Delivered (2026-11-23, branch `feat/agentic-foundations/4-4-thresholds-and-counter-metrics`).**
`tests/rag-benchmarks/protocol/thresholds.yaml` — the versioned registry: the
header (artifact, version, the sign-off owner `jrevillard (ITU)`, `signed:
false`) and one entry per M-1..M-5, each `status: absent` with its
`absent_reason` (the measured reference is pending, issue #2118), its surface,
its rationale and a null value. No threshold NUMBER is invented.

`tests/rag-benchmarks/protocol/thresholds.py` — `load_registry` (lazy PyYAML,
so the package stays importable and stdlib-only without it),
`validate_registry` (the strict shape: the artifact, a version, a sign-off
header WITH an owner, exactly one entry per measured dimension, each entry
naming its surface and rationale and carrying EITHER an agreed value + its
agreement date OR an explicit absence + its reason and no value),
`promotion_decision` (blocked unless every dimension is agreed AND the sign-off
is signed by a named owner; every blocking reason named one by one),
`derive_thresholds_artifact` (the gate-compatible artifact DERIVED from the
registry via `gate.thresholds_file` — the registry's content plus the
reference lineage; it refuses on a blocked promotion or a lineage-less
reference) and `build_thresholds_report` (the decision, the sign-off owner, the
per-dimension records, the digested registry, a canonical-JSON `digest`
recomputable via `thresholds_report_digest`).

`tests/rag-benchmarks/protocol/counter_metrics.py` — `build_counter_metrics_report`
over three first-class top-level records:
* **CM-1** — the per-request latency delta (every paired request's
  `reference_wall_ms` / `candidate_wall_ms` / `delta_ms`, plus the
  distribution over those deltas — the distribution never replaces them), the
  cost DELTA (available only when both sides carry a resource record) and the
  agentic cost surface (the candidate's own per-request counters + totals);
* **CM-2** — the excessive-abstention rate over the reference-correct cases,
  the denominator arriving as the lineage-verified `reference-correctness`
  ledger (`reference_correctness_file` / `verify_correctness_lineage`, the
  reference-defects-ledger pattern); no ledger, or a candidate that records no
  abstention fact, records CM-2 as NOT computable WITH its reason — the rate
  is never reported as zero;
* **CM-3** — the limit/cancellation rate with the per-case terminal states
  (the config-C `usage_record.outcome == budget_exhausted` marker, the
  config-C `cancelled` terminal, the config-B
  `abstention_reason == result_budget_exhausted` marker), the failure count
  and its rate beside it so a zero limit rate never hides a failing execution.

`tests/rag-benchmarks/protocol/run_protocol.py` — the `thresholds` and
`counters` subcommands; `ThresholdsRefusal` and `CounterMetricsRefusal` map
to the typed-refusal exit 1. `tests/rag-benchmarks/test_protocol_thresholds.py`
(34 tests) and `tests/rag-benchmarks/test_protocol_counter_metrics.py` (29
tests) — every matrix row through temp registries, fake reference manifests
and fixture rows. CI: the protocol pytest line gains the two new files.

**Decisions:**
- The registry is YAML (the human-editable form for a decision record a person
  signs) and PyYAML is imported INSIDE the loader — the package's stdlib-only
  invariant holds, and the venue-side commands keep working on a node without
  it.
- The registry's dimensions are reused from `e01.M_DIMENSIONS` — one spelling
  of M-1..M-5 in the tree.
- A missing sign-off OWNER is a refusal (the registry header is structurally
  invalid); an UNSIGNED sign-off is a blocking reason (a valid state that
  blocks). The matrix draws that line; the code keeps it.
- An absent dimension is a blocking reason, not a refusal: the report must be
  able to state what is missing.
- The derived thresholds artifact is written by the CLI into the run out-dir,
  where the gate's `*.json` scan finds it — a test drives the gate over a
  derived artifact to prove the chain verifies end to end.
- CM-3 counts limit and cancellation hits as the rate; a generic failure is
  recorded as a FAILURE with its own count and rate beside the limit rate (a
  failure is neither a limit nor a cancellation, and hiding it behind a zero
  limit rate is the failure mode the epic names).
- CM-2's abstention fact is read from the row's own mechanical fields
  (`abstained` / `abstention_reason`), never inferred from the answer text —
  an abstention the run did not record is absent, not guessed.
- CM-1's three surfaces (the latency delta, the cost delta, the agentic cost
  surface) are independent: an absent one is recorded as absent WITH its reason
  and never drags the surface beside it down with it. The cost totals name how
  many rows contributed (`{"sum": …, "n_rows": …}`) — a bare sum over a subset
  would read as the whole.

**Verification (this session):**
`cd tests/rag-benchmarks && pytest test_protocol_thresholds.py test_protocol_counter_metrics.py -q`
→ 63 passed.
`pytest test_capture_baseline.py test_protocol_evalset.py test_protocol_manifest.py test_protocol_gate.py test_protocol_reuse.py test_protocol_drivers.py test_protocol_security.py test_protocol_e01.py test_protocol_thresholds.py test_protocol_counter_metrics.py -q`
→ 323 passed (the two new files included; the gate's refusals and the E01
report unchanged).
`python3 -m py_compile protocol/*.py` → clean.
`ruff check --config ../../components/agent-service/pyproject.toml protocol/ test_protocol_thresholds.py test_protocol_counter_metrics.py`
→ no issues (the benchmark-relative invocation is the one that holds — from
the repository root the same config reports I001 over the whole protocol test
tree, pre-existing).
`python3 protocol/run_protocol.py thresholds --registry protocol/thresholds.yaml`
→ exit 1, the promotion decision BLOCKED, naming every absent dimension (with
its reason) and the unsigned sign-off, with the sign-off owner exposed.
`python3 protocol/run_protocol.py counters --reference-rows … --candidate-rows … --out …`
→ exit 0, CM-1 with the per-request deltas (50 ms / 60 ms) and their
distribution, CM-2 recorded NOT computable with its reason (no ledger), CM-3
with the limit and cancellation counts and the per-case terminal states.
The package still imports on a node WITHOUT PyYAML (probe: the import of
`protocol.run_protocol` / `protocol.thresholds` / `protocol.counter_metrics`
succeeds under a blocked `yaml` import, and the loader refuses with
`registry_unavailable`).
The test env needs pytest + pyyaml, plus pydantic/requests/openpyxl for the
pre-existing protocol suites (the `capabilities.contract` import chain) —
without them those suites fail on an import, not on a defect.

**One defect found by the manual CLI run (not by the suite) and fixed:** the
CM-1 cost totals summed every counter across the rows, so a row that recorded
no token count raised a KeyError. The totals now sum the counters the rows
actually carry and name how many rows contributed
(`{"sum": …, "n_rows": …}`) — a bare sum over a subset would read as the
whole. A test covers the partial record.

**Known limits (honest):** no threshold VALUE exists yet — every dimension
ships explicitly absent and the promotion is blocked by construction; the
agreed numbers land in the separate follow-up MR (PRD §8). The
reference-correctness ledger is campaign-authored (no authoring CLI) — the
harness verifies its lineage and applies it, it never judges correctness in
code. The registry's `signed`/`agreed_on` fields are the operator's to set:
until the operator edits the registry, no signed artifact can be produced.
Config C rows carry no abstention field today, so CM-2 over a config-C
candidate records the abstention fact as unrecorded (NOT computable) rather
than guessing one — the field is what CM-2 needs, and the driver that records
it belongs to story 4.5's candidate runs.

**Review corrections (C1) — 13 confirmed findings + 2 dead-code cuts, all
fixed, each pinned by a test.** The registry loader/type side: a quoted
`signed: "false"` is now refused (`sign_off_invalid`) — the sign-off is a
boolean or it is not; the known date fields
(`dimensions[*].agreement_date`, `sign_off.agreed_on`/`signed_on`) are
normalized to their ISO strings in place, so an unquoted `2026-12-01` reads as
the string the contract asks for instead of refusing misleadingly or crashing
the digest, and a value that is not JSON-serializable anywhere else is refused
`registry_malformed` naming the remedy (quote your scalars) instead of crashing
`sha256_json`; `promotion_decision` now validates the registry FIRST, so a
library caller can never read `allowed` (or a signed artifact) off a registry
the loader would refuse; an entry may not relabel its dimension — the
canonical `M_DIMENSIONS` name is required in the entry and is what the report
and the derived artifact carry, so the signed artifact can never disagree with
the E01 report's enumeration; `registry_version` must equal the supported
`THRESHOLD_REGISTRY_VERSION` (`registry_version_unsupported`); the report no
longer embeds the caller's registry path in its digested body (the digest is
content-only and reproducible across path spellings); the dead
`registry_sha256`/`reference_manifest_digest` helpers are deleted. The
counter-metrics side: `configuration_error` and `invalid_request` join
`FAILURE_STATES`, so an all-died run can no longer report `failure_rate: 0`;
a recorded abstention is its own terminal state (`abstained`, answered False) —
CM-3 and CM-2 now read the same case the same way; a non-boolean `abstained`
value (`"false"`) is never coerced — it counts as unrecorded; the
correctness ledger's `correct_case_ids` must be a list of scalars
(`correctness_invalid_ids`) and is deduplicated (first occurrence kept), so an
int cannot crash and duplicates cannot inflate the denominator; CM-1's cost
delta is `available` only when at least one counter is shared (disjoint
counters record `not_available_reason`, never an empty delta reading as zero)
and each delta row names the candidate-side counters the reference does not
carry (`candidate_only`); the dead `CM_METRICS` constant is deleted. The CLI:
a missing `--reference-manifest` is a usage error (exit 2, the same wording as
the missing `--out` case), not a refusal.

**FIX review round 1 — 2 nit-level defects introduced by the correction diff,
both fixed, each pinned.** (1) The date normalization wrote the optional
`agreed_on`/`signed_on`/`agreement_date` keys into a registry that omitted
them — it mutated the caller's dict and made the report's content digest
disagree with the parsed content; the rewrite now touches only keys that are
present. (2) The new `abstained` terminal state fired for ANY status, so a
`{status: error, abstained: true}` row was reclassified out of the failure
family; it is now gated on `status == "ok"` (the `result_budget_exhausted`
limit check keeps its place before it) — a failing row keeps the failure
family whatever abstention fact rides beside it.

## Spec Change Log

## Review Triage Log

**Global code-review (C1) on `1f5eb7147` — 12 findings, every claim verified
by an executed probe before it was filed; all 12 routed to patch (smallest
fix, no scope change) and fixed on `f3d8bd8f2`.**

| # | Finding | Severity | Verdict | Disposition |
|---|---------|----------|---------|-------------|
| F1 | A quoted `signed: "false"` reads as signed — promotion ALLOWED with no operator sign-off, a signed artifact written, the gate opened | important | confirmed (end-to-end probe: gate accepts the artifact) | **Fixed**: `validate_registry` requires a real bool (`sign_off_invalid`) |
| F2 | Unquoted YAML dates: `agreement_date: 2026-12-01` refuses misleadingly ("no agreement_date"); an unquoted `signed_on` crashes `build_thresholds_report` with an uncaught TypeError | important | confirmed (both probes) | **Fixed**: known date fields normalized to ISO strings in place; a non-serializable registry refuses `registry_malformed` with the remedy |
| F3 | `configuration_error`/`invalid_request` absent from `FAILURE_STATES` — a run where every execution died reports `failure_rate: 0` | important | confirmed (probe) | **Fixed**: both added |
| F4 | An abstained config-B row (status ok, abstained true) is reported as answered by CM-3 while CM-2 counts it as an abstention — the same report contradicts itself | important | confirmed (probe) | **Fixed**: a recorded abstention is its own terminal state (answered False), the budget-exhausted marker still wins |
| F5 | CM-1 cost delta `available: true` with an empty `per_request` when the sides share no counter — reads as "the delta is zero"; candidate-only counters vanish from the delta | important | confirmed (probe) | **Fixed**: available gated on non-empty deltas; `candidate_only` named per delta row |
| F6 | Library callers skip validation: `promotion_decision`/`derive_thresholds_artifact` sign an invalid registry (null surfaces) | important | confirmed (probe) | **Fixed**: `promotion_decision` validates first |
| F7 | An entry can relabel its dimension; the report and the signed artifact carry a name that disagrees with the E01 enumeration | important | confirmed (probe) | **Fixed**: the canonical `M_DIMENSIONS` name is required and always emitted |
| F8 | The report digest embeds the caller's registry path — not reproducible across path spellings, contradicting its own docstring | important | confirmed (probe: two digests for one registry) | **Fixed**: path removed from the digested body |
| F9 | `correct_case_ids` shape unchecked: an int crashes uncaught, a string becomes per-character ids, duplicates inflate the denominator | important | confirmed (probe) | **Fixed**: list-of-scalars validation (`correctness_invalid_ids`) + dedupe |
| F10 | `registry_version` never compared; dead helpers (`registry_sha256`, `reference_manifest_digest`, `CM_METRICS`) | nit | confirmed (grep) | **Fixed**: version equality enforced (`registry_version_unsupported`); dead code deleted |
| F11 | `_abstention_fact` coerces a string `"false"` to True — counted as an abstention | nit | confirmed (probe) | **Fixed**: only real bools accepted; otherwise unrecorded |
| F12 | Missing `--reference-manifest` exits 1 (refusal) while the missing `--out` exits 2 (usage) — inconsistent exit codes | nit | confirmed (probe) | **Fixed**: both are usage errors (exit 2) |

**FIX-REVIEW (chain round 1, f=0) on the C1 correction diff
(`1f5eb7147..f3d8bd8f2`) — 12/12 CONFIRMED-RESOLVED, mutation-sensitive (the
new pins run red against the base modules: 17 failed / 44 passed), and two new
nit-level defects found in the correction itself, both fixed in the same
chain:**

| # | Finding | Severity | Verdict | Disposition |
|---|---------|----------|---------|-------------|
| R1 | `validate_registry` INSERTS the optional date keys when absent — a registry whose sign-off omits `agreed_on`/`signed_on` gets `None` injected, so the report's `registry.sha256` stops matching the parsed content and the caller's dict is mutated (the pure-function docstring lied) | nit | confirmed (probe: two different digests for one file) | **Fixed**: rewrite a date field only when the key exists |
| R2 | The new abstained terminal state fired for ANY status — a `{status: error, abstained: true}` row was reclassified out of the failure family | nit | confirmed (probe) | **Fixed**: the abstained state is gated on `status == "ok"` (the budget-exhausted marker keeps its place before it) |

## Design Notes

**Why the registry is YAML and not JSON.** OQ-5 asked where the agreed thresholds live; the operator's decision names a versioned registry file in the protocol package. YAML is the human-editable form for a decision record that a person signs — the loader reads it with PyYAML (already installed by the `test:rag-benchmarks` job), imported lazily so the package stays importable without it.

**Why the thresholds artifact is derived, not authored.** The gate consumes a thresholds FILE with a reference lineage. If the file were authored independently of the registry, two homes for the same decision would exist and could drift — the gate would verify a lineage while the numbers came from somewhere else. The registry is the decision; the artifact is that decision bound to a measured reference.

**Why absence blocks instead of defaulting.** PRD §8: thresholds are agreed after the reference is measured and before the candidate is assessed; an absent threshold blocks promotion to the stage it guards. A default would silently manufacture a pass — the exact failure the PRD names.

**Why CM-2's denominator is an artifact.** "Questions the reference answers correctly" is a judged fact about the reference run, not something a heuristic can infer from rows. The denominator therefore rides a lineage-verified campaign artifact (the reference-defects ledger pattern), and its absence is recorded — a zero rate would be a claim nobody made.

## Verification

**Commands:**
- `cd tests/rag-benchmarks && pytest test_protocol_thresholds.py test_protocol_counter_metrics.py -q` -- expected: all green
- `cd tests/rag-benchmarks && pytest test_capture_baseline.py test_protocol_evalset.py test_protocol_manifest.py test_protocol_gate.py test_protocol_reuse.py test_protocol_drivers.py test_protocol_security.py test_protocol_e01.py test_protocol_thresholds.py test_protocol_counter_metrics.py -q` -- expected: the whole protocol suite green (the gate's refusals and the E01 report unchanged)
- `cd tests/rag-benchmarks && python3 -m py_compile protocol/*.py` -- expected: clean
- `cd tests/rag-benchmarks && python3 protocol/run_protocol.py thresholds --registry protocol/thresholds.yaml` -- expected: the promotion decision is BLOCKED, naming every absent dimension and the unsigned sign-off
