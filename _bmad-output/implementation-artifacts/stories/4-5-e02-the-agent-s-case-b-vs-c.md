---
title: 'Story 4.5 — E02: the agent''s case (B vs C)'
type: 'feature'
created: '2026-11-24'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '4b14b4e06950c884cb683de0d6893e4889f10213'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-genie-ai-2026-11-16/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — the issue #1981 acceptance criteria, operator-authored">

## Intent

**Problem:** Epic 4 has the machinery for E01 (A vs B — the comparison layer, story 4.3) and the threshold/counter-metric surfaces (story 4.4), but nothing compares the FIXED pipeline to the AGENT: the E02 pair's conditions are shipped (`protocol/pairs.py`) and its config-C driver exists (`protocol/drivers.py`), yet no report joins a B leg with a C leg, so the agentic delta — the whole point of the agent — is unmeasured. The NFR-3 coexistence criterion (the legacy path must keep serving existing traffic unchanged under concurrent agentic load) has no executable form either: today it could only be a sentence in a report, and a report that hid a slowed or failing legacy response would still read as a pass. And the S4 exit evidence bundle (E01 + E02 + bounded execution + rollback demo + coexistence criterion) has no home that names each piece and its state.

**Approach:** Add the E02 comparison layer to the protocol package (`protocol/e02.py`): a pure, digest-pinned join of the B leg (rows + manifest) and the C leg (rows + manifest) into per-dimension M-1..M-5 records for BOTH configurations, the gains per query class, the costs (CM-1..CM-3, reused from story 4.4), the thresholds applied where the operator agreed them and an explicit absence where not, the uncontrolled differences, and an honest verdict. Add the coexistence criterion (`protocol/coexistence.py`): a CONTROLLED comparison — legacy-only vs legacy-under-agent-load — whose verdict is computed, never narrated, and whose report always carries both phases' legacy numbers. Add the S4 exit evidence bundle as a checklist in the epic's established form (`docs/baselines/s4-exit-checklist.md`, the sibling of `docs/baselines/s3-exit-checklist.md`), naming each piece's evidence artifact and its state.

**Operator decisions carried into this story (2026-11-23/24):**
- The retrieval-quality thresholds are SIGNED (MR !1063, in flight): `retrieval_recall >= 0.95`, `recall_at_10 >= 0.95`, `ndcg_at_10 >= 0.90`, `passage_recall >= 0.95`, `noise <= 0.80` — basis: the measured config-A reference of issue #2118 (corpus `6c9f7371…`, assessment-set `58850161…`). This story NEVER duplicates `protocol/thresholds.yaml` and NEVER invents a threshold: the registry stays story 4.4's single home.
- That signature covers M-1 ONLY. M-2 (answer grounding), M-3 (abstention correctness), M-4 (latency) and M-5 (resource consumption) stay EXPLICITLY absent, and `promotion_decision` therefore stays BLOCKED (`protocol/thresholds.py:352`): an incomplete registry produces NO signed thresholds artifact, so the partial-order gate keeps refusing every gated B/C run. That refusal is this story's honest live outcome, recorded verbatim — never worked around.
- The E02 pair's live legs are the GATED B and C runs: the gate's lineage anchor is the config-A reference manifest (the thresholds bind to it), so config B must be measured as a gated leg in the same run directory as config C. No ungated config-B reference path is introduced.

## Boundaries & Constraints

**Always:**
- The E02 report is a pure function of its inputs plus a pinned `created_utc`: every input artifact is digested into the report's inputs record, and the same inputs under the same pin produce an identical digest.
- M-1..M-5 are reported for BOTH configurations with the measurement surface named; a surface a configuration cannot provide (config C carries no mechanical `abstained` flag — the no-agent pipeline owns that flag) is recorded as not available WITH its reason — never invented, never silently dropped.
- The thresholds are APPLIED, never authored: the report reads the agreed bounds from the signed thresholds artifact when one exists and records an EXPLICIT absence (with the blocking reason) when it does not. An absent threshold blocks the affected conclusion; it is never defaulted, never read as satisfied.
- The gains are reported PER QUERY CLASS, and the multi-hop/ambiguous classes are named explicitly: when the assessment set carries no case of a class, the report records that class as not covered WITH the reason — the agentic benefit the PRD §4.1 note describes stays a hypothesis until it is measured on a set that carries the class.
- The costs are first-class: CM-1 (per-request cost/latency delta, the delta visible), CM-2 (excessive abstention on the reference-correct cases) and CM-3 (limit/cancellation rate) are top-level records, reused from story 4.4 — never recomputed here and never folded into a dimension's record.
- The coexistence criterion is COMPUTED, not narrated: the verdict follows the agreed limits, and both phases' legacy numbers (latency, errors, availability) are in the report whatever the verdict — a report that omits or smooths a slowed or failing legacy response is a defect, and the criterion fails when the legacy path degraded under agent load.
- The saturation/admission response is a measured observation: the agentic lane's refusal (the admission lane's `LaneBusyError`, surfaced as the seam's 429 with `Retry-After`) is recorded as the observed response, and its rate is part of the report.
- Absent inputs are recorded as absent WITH their reason — never as a zero, never silently dropped. An absent agreed limit makes the coexistence verdict BLOCKED, not passed and not failed.
- The S4 exit bundle is a checklist in the epic's form: each piece names its evidence artifact, its state and the artifact that would change the state; a piece with no evidence is OPEN, and the bundle is not declared complete while any piece is open.

**Never:**
- No threshold number is authored, duplicated or derived here: `protocol/thresholds.yaml` stays story 4.4's single home and the signed artifact is consumed as-is.
- No change to the partial-order gate, the threshold registry/loader, the counter-metrics layer, the pair conditions, the drivers, the no-agent pipeline, the agent loop, the budgets or the admission lane: this story is a caller on all of them.
- No change under `eval/` or `capture_baseline.py` (`harness_sha` is the reuse identity).
- No deployment corpus content authored: fixture rows only; the live assessment set stays frozen at its signed digest.
- No judging in code: M-2/M-3 verdicts belong to the judge layer under the versioned evaluator instructions — the report carries the judgment inputs, never a verdict it invented.
- No new runtime dependency (stdlib-only driver side); no live-venue dependency in the test suite (fake seams only).
- No merge, no push to `main`/`release/*`, no widening into the live campaign's deployment work: the live E02 measurement and the live coexistence measurement are separate campaign activities (see the residual recorded in the Implementation Notes).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| e02, consistent legs | B rows + C rows; both manifests carry the same corpus fingerprint and assessment-set digest | `e02.report.json`: M-1..M-5 for B and C with their surfaces, the gains per query class, CM-1..CM-3, the thresholds applied, the uncontrolled differences, an honest verdict, a digest | typed refusal naming the mismatch |
| e02, lineage mismatch | the two legs' corpus fingerprint or set digest differ | refused before building, naming the mismatch | typed refusal, exit 1 |
| e02, wrong-leg manifest | the B leg's manifest is a config-A reference manifest, or the C leg's manifest is config B | refused (a leg is not the leg it claims to be) | typed refusal |
| e02, thresholds absent | no signed thresholds artifact supplied | every dimension's threshold recorded as absent with its blocking reason; the verdict is unassessable — never a pass | N/A |
| e02, thresholds present | a signed thresholds artifact with the lineage of the legs | the agreed bounds applied per dimension; a leg outside a bound is a FAIL on that dimension | N/A |
| e02, multi-hop/ambiguous classes absent | the assessment set carries no case of the class | the class recorded as not covered, with the reason and the remedy named | N/A |
| e02, reproducibility | the same inputs rebuilt under the same pinned `created_utc` | an identical digest | N/A |
| coexistence, legacy degraded | the legacy path under agent load exceeded an agreed limit | the verdict is FAIL; both phases' legacy numbers are in the report | N/A |
| coexistence, limits absent | no agreed legacy latency/error/availability limit | the verdict is BLOCKED with the missing limit named — never a pass, never a default limit | N/A |
| coexistence, agent lane saturated | the agentic load was refused by the admission lane | the refusal count and the observed response are recorded; the legacy phase is unaffected in the report | N/A |
| coexistence, legacy path unaffected | the legacy numbers under load stay within the agreed limits | the verdict is PASS, and the numbers are in the report anyway | N/A |
| coexistence, one phase missing | the control or the loaded measurement is absent | refused — a comparison needs both phases | typed refusal |

</frozen-after-approval>

## Code Map

**Reuse (do not reinvent):**
- `tests/rag-benchmarks/protocol/e01.py` — the comparison-layer precedents: `M_DIMENSIONS` (:74), `HONEST_EVIDENCE_STATEMENT` (:82), `_surface_record` (:516), `_ok_rows` (:527), `_latency_stats` (:627), `_latency_surface` (:650), `_recorded_comparison` (:698), `_verify_legs` (:390) (the two-leg lineage verification), `E01Refusal` (:251), `e01_report_digest`.
- `tests/rag-benchmarks/protocol/counter_metrics.py` — `build_counter_metrics_report` (:659) (CM-1/CM-2/CM-3, the reference/candidate pair), `COUNTER_METRICS_REPORT_ARTIFACT` (:48), `reference_correctness_file` (:128) / `verify_correctness_lineage` (:152) (CM-2's denominator), `CounterMetricsRefusal` (:98).
- `tests/rag-benchmarks/protocol/manifest.py` — `sha256_json` (:70), `redact` (:83), `build_manifest` (:119), `manifest_digest` (:182), `manifest_lineage` (:187).
- `tests/rag-benchmarks/protocol/gate.py` — `thresholds_file` (:72), `is_thresholds_file` (:68), `check_gated_run` (:97) — READ ONLY; the refusal vocabulary is untouched.
- `tests/rag-benchmarks/protocol/thresholds.py` — `MEASURED_DIMENSIONS` (:51), `promotion_decision` (:352), `derive_thresholds_artifact` (:417) — the signed artifact's shape and the promotion block; READ ONLY.
- `tests/rag-benchmarks/protocol/pairs.py` — `PAIR_CONDITIONS` (:29) (the shipped E02 conditions), `CONFIG_PAIR` (:56), `pair_conditions` (:67), `check_run_against_pair` (:75).
- `tests/rag-benchmarks/protocol/drivers.py` — the row vocabulary: config-B rows (`case_id`, `status`, `answer`, `abstained`, `abstention_reason`, `source_documents`, `metadata`, `wall_ms`) and config-C rows (`case_id`, `outcome`, `run_id`, `wall_ms`, `answer`, `source_documents`, `usage_record`, `cancel_requested`, `cancelled`, `error_text`) — `run_one_case_c` (:790), `run_config_c` (:905), the outcome constants (:661-668).
- `tests/rag-benchmarks/protocol/evalset.py` — `COMPOSITION_CLASSES` (:60), `DEFAULT_COMPOSITION_MINIMINUMS` (:72), the `expectations` free-form dict (:280) (the per-case query-class tag's home — no schema change needed), `load_entries` / the validation entry points.
- `tests/rag-benchmarks/protocol/run_protocol.py` — the CLI conventions: `build_parser` (:687) (argparse subparsers with `set_defaults(func=cmd_*)`), `main` (:787) (typed refusals → exit 1, usage → exit 2), `_write_manifest` / `_write_findings_report` (the out-dir writers), `_add_created_utc_arg` (the digest pin).
- `tests/rag-benchmarks/protocol/verdicts.py` — `build_verdicts` (:559) (the judge layer's row reading; `row.get("outcome", row.get("status"))` is the terminal-row reader), `VERDICT_VALUES` (:106).
- `tests/rag-benchmarks/protocol/findings.py` — `build_findings_report` (:78), `report_digest` (:59) (the versioned-artifact header + digest precedent).
- `components/agent-service/noagent/lane.py` — `AdmissionLane` / `LaneBusyError` (the flock slot pool: a saturated lane REFUSES, never queues — the observed saturation/admission response).
- `components/agent-service/noagent/pipeline.py` — `NoAgentResult.abstained` (:111) (the mechanical abstention flag config B carries and config C does not).

**Facts (not to re-derive):**
- The gate scans EVERY `*.json` in the run out-dir and routes by `artifact`; a derived thresholds artifact written into that out-dir is exactly what it finds.
- The gate's lineage anchor is the config-A reference manifest: the signed thresholds bind to its digest, so the E02 run directory carries that manifest and the B and C legs are BOTH gated runs in it. A config-B reference manifest in the same directory would supersede the anchor (newest wins) and break the thresholds' lineage — so no such manifest is produced.
- `promotion_decision` requires EVERY measured dimension to carry an agreed value plus a signed sign-off. After MR !1063 (M-1 agreed, M-2..M-5 absent) the decision is BLOCKED and `derive_thresholds_artifact` refuses — so no signed thresholds artifact exists and the gated legs keep refusing. That refusal is the honest live state, not a defect.
- The live assessment set is frozen at digest `58850161afeb…` by the signed thresholds' lineage: a set change invalidates the signature. Its 16 cases carry no multi-hop/ambiguous tagging, and the protocol's composition classes (`evalset.py:60`) do not include those classes.
- Config C's rows carry no mechanical `abstained`/`abstention_reason` fields (the no-agent pipeline owns that flag) — M-3's config-C surface is the answer text, judged under the evaluator instructions.
- The protocol suite's conventions: plain pytest, function-style tests, no `conftest.py`, imports like `from protocol import gate` (the suite runs from `tests/rag-benchmarks`), typed refusals asserted through `pytest.raises` + `failed.value.reason`, the CLI exercised both by a hand-built `argparse.Namespace` and through `main(argv)` for the exit-code path.
- The S3 exit checklist (`docs/baselines/s3-exit-checklist.md`) is the bundle precedent: an evidence table (check → artifact → state), never a status report.

## Tasks & Acceptance

**Execution:**
- [x] `tests/rag-benchmarks/protocol/e02.py` -- NEW: the E02 comparison layer (the two-leg lineage verification, M-1..M-5 for both legs with their surfaces, the gains per query class with the multi-hop/ambiguous classes named when absent, the thresholds applied or explicitly absent, the uncontrolled differences, the honest verdict, the pure-function digest) -- the agent's case has a report.
- [x] `tests/rag-benchmarks/protocol/coexistence.py` -- NEW: the NFR-3 coexistence criterion (the controlled legacy-only vs legacy-under-agent-load comparison, the agreed-limits application with an absent limit recorded as blocking, the saturation/admission response and rate, the resource consumption under load, the computed verdict) -- the legacy non-regression is a criterion, not a sentence.
- [x] `tests/rag-benchmarks/protocol/run_protocol.py` -- the `e02` and `coexistence` subcommands (typed refusal → exit 1) and the two refusal classes in `main`'s except list -- the CLI surface of both.
- [x] `tests/rag-benchmarks/test_protocol_e02.py` -- NEW: every e02 row of the matrix through fixture rows and fixture manifests -- the E02 contract is executable.
- [x] `tests/rag-benchmarks/test_protocol_coexistence.py` -- NEW: every coexistence row of the matrix through fixture measurements -- the criterion is executable.
- [x] `docs/baselines/s4-exit-checklist.md` -- NEW: the S4 exit evidence bundle in the S3 checklist's form (E01, E02, bounded execution V06, rollback demo V08, the coexistence criterion — each with its evidence artifact and its state) -- the bundle is assemblable from the epic's artifacts.
- [x] `.gitlab-ci.yml` -- the protocol pytest line gains the two new test files -- the new suites run in CI.
- [x] `_bmad-output/implementation-artifacts/stories/4-5-e02-the-agent-s-case-b-vs-c.md` + `_bmad-output/implementation-artifacts/sprint-status.yaml` -- the story to `in-review`/row `review` (at completion) -- BMAD bookkeeping.
- [x] `_bmad-output/implementation-artifacts/e02-attempt-2026-11-24/` -- the E02 attempt's record: the two gated legs' verbatim refusals and the join's refusal, with the reference manifest and the assessment set the chain needs -- the enforced order, evidenced.

**Acceptance Criteria:**
- Given a B leg and a C leg that ran under the same corpus and the same assessment set, when the E02 report is built, then M-1..M-5 are reported for BOTH configurations with their measurement surfaces named, the gains are reported per query class and the costs (CM-1..CM-3) are first-class records, and the multi-hop/ambiguous classes the PRD §4.1 note names are explicitly recorded as not covered when the set carries no case of them (issue #1981 AC 1).
- Given the signed thresholds, when the report is built, then the agreed bounds are applied per dimension and an absent threshold is recorded as absent with its blocking reason — never defaulted, never reported as satisfied (PRD §8).
- Given a legacy path that slowed or failed under concurrent agent load, when the coexistence criterion is computed, then the verdict is FAIL and both phases' legacy numbers are in the report; a report that omitted them is a defect, not a pass (issue #1981 AC 2).
- Given a legacy limit nobody agreed, when the coexistence criterion is computed, then the verdict is BLOCKED with the missing limit named — not a pass and not a fail.
- Given the same inputs and a pinned `created_utc`, when the E02 report and the coexistence report are rebuilt, then their digests are identical.
- Given the epic's artifacts, when the S4 exit checklist is read, then every piece of the bundle (E01, E02, bounded execution, rollback demo, coexistence criterion) names its evidence artifact and its state, and a piece with no evidence is OPEN rather than declared delivered (issue #1981 AC 4).

## Implementation Notes

**Delivered (2026-11-24, branch `feat/agentic-foundations/4-5-e02-the-agent-s-case-b-vs-c`).**

**What shipped:**
- `protocol/e02.py` — the E02 comparison layer. The two-leg verification (presence → leg identity → lineage, with the E02-specific rule that both legs must have been gated against the SAME predecessor), M-1..M-5 for both legs with their surfaces named, the gains per query class, the thresholds applied or explicitly absent, the uncontrolled differences, the honest verdict, and the pure-function digest.
- `protocol/coexistence.py` — the NFR-3 criterion. The controlled comparison (legacy alone vs legacy under concurrent agentic load), the agreed-limits application, the saturation/admission response and the resource consumption under load, and the computed verdict. The verdict vocabulary is `pass` / `fail` / `blocked` — an absent or unmeasurable limit blocks, it never passes.
- `run_protocol.py` — the `e02` and `coexistence` subcommands (typed refusal → exit 1) and the two refusal classes in `main`'s except list.
- `test_protocol_e02.py` (19 tests) + `test_protocol_coexistence.py` (16 tests) — every matrix row through fixture rows, synthetic manifests and a synthetic signed artifact. The whole protocol suite is green: **334 passed**.
- `docs/baselines/s4-exit-checklist.md` — the S4 exit evidence bundle in the S3 checklist's form: E01, E02, bounded execution (V06), rollback demo (V08), the coexistence criterion — each with its evidence artifact and its state, plus the table of what the measured order still blocks on.
- `_bmad-output/implementation-artifacts/e02-attempt-2026-11-24/` — the E02 attempt's record: the two gated legs' verbatim refusals, the join's refusal, the reference manifest and the assessment set (byte-identical, digest `58850161afeb…`) the chain needs, and a note explaining each.
- `.gitlab-ci.yml` — the protocol pytest line gains the two new test files.
- `tests/rag-benchmarks/CLAUDE.md` — the Layout tree gains the two new modules and the two new subcommands (the deferred "the tree predates the protocol package" item was stale for everything but the two new files; this discharges it).

**The live outcome — the gate refuses, and that is the point.** The E02 attempt ran the two gated legs and the join against the real reference and the real set (the corpus fingerprint PINNED to the measured reference's — the operator's declaration, the same value the reference manifest carries). All three refused, verbatim, in `_bmad-output/implementation-artifacts/e02-attempt-2026-11-24/`:

```
REFUSED: gated run refused (config B): reference manifest 8dc67fa1804e covers corpus
6c9f73719c0451cdcbca19e86bc38476ade96be9945811133c5a23071377eb98, but no signed thresholds
file references it.
```

The reference manifest digest (`8dc67fa1804e`) is the SAME one the E01 config-B leg was refused against on 2026-11-23 — the chain did not drift. The blocker is the SECOND predecessor: story 4.4's signed thresholds artifact.

**The finding the orchestrator's premise rests on (2026-11-24).** The operator's 2026-11-23 signature (MR !1063) covers **M-1 only**; M-2..M-5 stay explicitly absent, and `promotion_decision` (protocol/thresholds.py:352) therefore stays BLOCKED — `derive_thresholds_artifact` refuses, so **no signed thresholds artifact is produced and the gated legs keep refusing after !1063 lands**. The unblocking decision is the operator's: M-2 (answer grounding), M-3 (abstention correctness), M-4 (latency) and M-5 (resource consumption) agreed against the measured reference. Nothing in the harness needs to change for them to run.

**Two absences the live campaign will hit, stated up front.**
1. *The multi-hop/ambiguous gains.* The assessment set carries no case of those classes and the protocol's composition classes do not include them; the set is frozen at the digest the signed thresholds bind to, so it cannot be extended without invalidating the signature. The E02 report records those classes as NOT COVERED — the benefit stays a HYPOTHESIS (PRD §4.1). The report reads the class from the case's `expectations.query_class` (a field the `expectations` dict already allows — no schema change) and falls back to the composition class.
2. *The legacy limits.* NFR-3's criterion needs "agreed legacy latency/error/availability limits". M-4 is absent and error/availability have no dimension of their own in M-1..M-5, so the coexistence verdict is BLOCKED with the missing limit named — never a default, never a pass.

**The residual.** The live E02 measurement and the live coexistence measurement are a campaign activity, not this story's code: the first needs the signed thresholds (the operator's M-2..M-5 decision), the second needs the agentic path deployed on the venue AND the agreed legacy limits. Both are filed as ONE backlog issue — **#2146** ("Story 4.5 residual — the live E02 measurement and the live coexistence criterion", `status::backlog`), the way #2118 was story 4.3's residual — so the blocker is durable and named, with the three unblocking steps written down.

**Surprises worth recording.**
- The signed M-1 bounds are scoped to **config A's chunk-level anchor metrics** (`value.scope` in the registry) — they do NOT transfer to the E02 legs, which measure the doc-level surface. The report's threshold application is scope-aware: a bound the surface does not carry is recorded as NOT MEASURABLE (with the scope quoted), never applied across surfaces and never read as a pass.
- Config C's rows carry NO mechanical abstention flag (the no-agent pipeline owns `abstained`), so M-3's config-C surface is the answer text — recorded with the reason, not invented as a count.
- The gate recognises ONLY `kind == "reference"` manifests (config A) as predecessors — a config-B manifest is `kind == "gated"`. So the E02 run directory carries the config-A reference manifest (the thresholds bind to it) and BOTH legs are gated runs in it.

## Spec Change Log

## Review Triage Log

## Design Notes

**Why the live E02 legs are refused, and what that does NOT mean.** The partial-order gate (story 4.1) refuses a gated B/C run until a SIGNED thresholds artifact exists, and story 4.4's `promotion_decision` produces that artifact only when every measured dimension (M-1..M-5) carries an agreed value. The operator's 2026-11-23 signature covers M-1 alone; M-2..M-5 stay explicitly absent. So the gate keeps refusing — and that refusal is the protocol working as designed (PRD §8: "an absent threshold blocks promotion rather than defaulting"), not a defect to route around. The live outcome of this story is therefore: the machinery ships, the refusal is recorded verbatim, and the live measurement waits on an operator decision nobody but the operator can make.

**The two absences the live campaign will hit, stated up front.**
1. *The multi-hop/ambiguous gains.* The PRD §4.1 note positions the agentic benefit on multi-hop and ambiguous queries. The live assessment set (16 cases) carries no such tagging and the protocol's composition classes do not include those classes; the set is frozen at digest `58850161afeb…` by the signed thresholds' lineage, so it cannot be extended without invalidating the signature. The E02 report therefore records those classes as NOT COVERED, with the reason — the gains the literature describes stay a hypothesis until a signed set carries them.
2. *The legacy limits.* NFR-3's criterion compares the legacy path against "agreed legacy latency/error/availability limits". Only the retrieval-quality bounds are agreed; M-4 (latency) is absent and error/availability have no dimension of their own in M-1..M-5. The coexistence verdict is therefore BLOCKED on the missing limits, with the limit named — never a default.

**The query-class tag's home.** The per-case query class is read from the case's `expectations.query_class` when present, falling back to the case's `case_class`. `expectations` is already a free-form per-case dict (`evalset.py:280`) — no schema change, no new field, and the composition floor is untouched. A set that wants multi-hop/ambiguous gains tags its cases; a set that does not is reported as not covering them.

## Verification

**Commands:**
- `cd tests/rag-benchmarks && python3 -m pytest test_protocol_e02.py test_protocol_coexistence.py -q` -- expected: PASS (the new suites, fake seams only).
- `cd tests/rag-benchmarks && python3 -m pytest -q` -- expected: PASS (the whole protocol suite stays green).
- `cd tests/rag-benchmarks && python3 -m protocol.run_protocol e02 --help` and `... coexistence --help` -- expected: the two subcommands are registered.
- `python3 -m ruff check tests/rag-benchmarks/protocol/` -- expected: clean (the repo's lint lane).

**Manual checks:**
- The E02 report's `verdict` names the agentic benefit as a hypothesis unless a dimension's gain is measured against an agreed threshold — a positive verdict on unmeasured dimensions is a defect.
- The coexistence report contains BOTH phases' legacy latency/error/availability numbers in every verdict state.
