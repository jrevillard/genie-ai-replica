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
- `tests/rag-benchmarks/protocol/redaction.py` — NEW: the depth-aware credential rule, ONE home for the reports that write whole rows (the E01 report's private copy moved here in this story; the E02 report applies the same rule on every path it writes).
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
- `test_protocol_e02.py` (54 tests) + `test_protocol_coexistence.py` (33 tests) — every matrix row through fixture rows, synthetic manifests and a synthetic signed artifact; the counts grew through the review rounds the triage log below records. The whole protocol suite is green: **391 passed**.
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

**The finding the orchestrator's premise rests on (2026-11-24), CONFIRMED POST-MERGE.** The operator's 2026-11-23 signature (MR !1063, merged as `9ca967274`) covers **M-1 only**; M-2..M-5 stay explicitly absent, and `promotion_decision` therefore stays BLOCKED — `derive_thresholds_artifact` refuses, so **no signed thresholds artifact is produced and the gated legs keep refusing after !1063 has landed**. This was verified on THIS branch after merging the umbrella tip: the merged registry's sign-off IS signed and M-1 carries the five bounds, and the promotion decision is still blocked on M-2..M-5 (the verbatim decision is in `e02-attempt-2026-11-24/thresholds-promotion-refusal.txt`; both gated legs were re-attempted post-merge and refused with the same reference digest). The unblocking decision is the operator's: M-2 (answer grounding), M-3 (abstention correctness), M-4 (latency) and M-5 (resource consumption) agreed against the measured reference. Nothing in the harness needs to change for them to run.

**The second hold on the C leg — issue #2145 (operator directive, 2026-11-24).** Even once the gate opens, the C verdict must not be composed before #2145 (the gold annotations) is handled: 10 of the assessment set's cases carry no gold annotation, 7 of them answerable-class, so the agent's answers on them are not judgeable. The C leg's refusal record carries the hold.

**Two absences the live campaign will hit, stated up front.**
1. *The multi-hop/ambiguous gains.* The assessment set carries no case of those classes and the protocol's composition classes do not include them; the set is frozen at the digest the signed thresholds bind to, so it cannot be extended without invalidating the signature. The E02 report records those classes as NOT COVERED — the benefit stays a HYPOTHESIS (PRD §4.1). The report reads the class from the case's `expectations.query_class` (a field the `expectations` dict already allows — no schema change) and falls back to the composition class.
2. *The legacy limits.* NFR-3's criterion needs "agreed legacy latency/error/availability limits". M-4 is absent and error/availability have no dimension of their own in M-1..M-5, so the coexistence verdict is BLOCKED with the missing limit named — never a default, never a pass.

**The residual.** The live E02 measurement and the live coexistence measurement are a campaign activity, not this story's code: the first needs the signed thresholds (the operator's M-2..M-5 decision), the second needs the agentic path deployed on the venue AND the agreed legacy limits. Both are filed as ONE backlog issue — **#2146** ("Story 4.5 residual — the live E02 measurement and the live coexistence criterion", `status::backlog`), the way #2118 was story 4.3's residual — so the blocker is durable and named, with the three unblocking steps written down.

**Surprises worth recording.**
- The signed M-1 bounds are scoped to **config A's chunk-level anchor metrics** (`value.scope` in the registry) — they do NOT transfer to the E02 legs, which measure the doc-level surface. The report's threshold application is scope-aware: a bound whose scope names another configuration is recorded as NOT APPLICABLE, and a bound the surface does not carry is NOT MEASURABLE — neither is applied, neither is a pass.
- Config C's rows carry NO mechanical abstention flag (the no-agent pipeline owns `abstained`), so M-3's config-C surface is the answer text — recorded with the reason, and NO abstention count is published for that leg: a count nobody measured is never a zero.
- The gate recognises ONLY `kind == "reference"` manifests (config A) as predecessors — a config-B manifest is `kind == "gated"`. So the E02 run directory carries the config-A reference manifest (the thresholds bind to it) and BOTH legs are gated runs in it.
- The gate stamps the digest of the thresholds artifact it selected into each leg's manifest: the report applies the artifact the legs were gated under, and refuses any other.

**The global review (round 1) — 16 important findings, all applied.**
The first global review of the implementation commit returned 16 important findings, 2 nits and 1 pre-existing (the pre-existing one is environmental: the reviewer's venv lacked `pydantic`, and the suite is green with it installed — 353 protocol + 214 eval + 24 capture tests). The important findings and their corrections:

1. *A fabricated zero on the agent's abstention surface* → the M-3 config-C surface no longer publishes an abstention count at all; a signed bound on it is NOT MEASURABLE, never a measured breach.
2. *The verdict compared no legs* → the verdict is now a B-vs-C comparison: a bound the FIXED pipeline breaks is its own state (recorded, never the agent's verdict), a bound the AGENT breaks — or a coverage below the fixed pipeline's — is a measured regression, and the per-dimension comparison carries the shared metrics' deltas.
3. *The signed scope was decorative* → the scope is ACTED ON: a scope naming another configuration makes the bound NOT APPLICABLE, whatever metric names it carries.
4. *No depth-aware redaction in E02* → the depth-aware rule moved to ONE home (`protocol/redaction.py`, shared with E01), and every row, cost value and manifest map the E02 report writes goes through it.
5. *The thresholds digest was never checked* → the artifact the report applies must be the one the gate stamped into both legs; another one is refused.
6. *The class census came from the rows, and the set's digest was never checked* → the census comes from the assessment set, the set's digest is verified against the legs' lineage (and recorded in the report's inputs), and the `--set` argument is required.
7. *An incomparable bound was recorded as a breach* → `None` (not comparable) is now distinct from `False` (breached): an incomparable direction or threshold is UNINTERPRETABLE, and it blocks.
8. *An empty bound set read as satisfied* → an empty bound set is an ABSENCE, never an assessed dimension.
9. *A single bound never read its metric name* → it carries the name through, and a bound that names no metric is UNINTERPRETABLE (the reason no longer blames the surface).
10. *The two legs' M-5 surfaces had different shapes* → both publish the same aggregated run-level cost counters.
11. *An admission refusal counted as a failure* → the per-class counts use the counter-metrics' terminal-state vocabulary, so the report no longer contradicts its own CM-3 record.
12. *The model ids and prompt digests were copied without a comparison* → they carry a comparison state (identical / different / not recorded) like E01's.
13. *A null signed value crashed the build* → it records an absence.

The coexistence criterion's four:
14. *The control-vs-loaded regression never entered the verdict* → the criterion now needs an AGREED regression tolerance (the operator's, like every other bound); a degradation past it FAILS the criterion, and no agreed tolerance means the controlled comparison's own question is not measurable → BLOCKED, never a pass.
15. *The request count was derived from the outcome tally* → the saturation check needs an independent request count; without one it is NOT MEASURED (and the verdict blocks), so a vanished request can never hide.
16. *The two phases' request mixes were never compared* → a mismatch is recorded and BLOCKS the verdict (the numbers stay visible).

The two nits: the limits artifact that declares a lineage can no longer be applied without one (a typed refusal), and the S4 checklist no longer claims M-1 is agreed on this branch (the signature lives in the open draft MR !1063).

## Spec Change Log

## Review Triage Log

Global review round 1 (the implementation commit, 2026-11-24): 16 important, 2 nit, 1 pre-existing. Every finding was verified against the code and applied — none was dismissed.

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| 1 | the C M-3 surface published `n_rows_with_abstention_fact: 0` — a fabricated zero a signed bound could compare against | important | applied — the key is gone; a bound on it is NOT MEASURABLE |
| 2 | `_verdict` compared no legs (each leg's own absolute bound) and a B-leg failure flipped the agent's verdict | important | applied — the verdict is a B-vs-C comparison; the fixed pipeline's failures are its own state |
| 3 | the signed `scope` was quoted, never acted on | important | applied — a scope naming another configuration makes the bound NOT APPLICABLE |
| 4 | E02 wrote rows with no depth-aware credential redaction | important | applied — the rule moved to `protocol/redaction.py` (one home, shared with E01) and every written path goes through it |
| 5 | the thresholds artifact's digest was never compared with the legs' `lineage.thresholds_sha256` | important | applied — the report applies the artifact the legs were gated under, or refuses |
| 6 | the class census came from the rows and the set's digest was never checked | important | applied — the census comes from the set, its digest is verified against the legs and recorded |
| 7 | an incomparable bound was recorded as a breach (`None` is falsy) | important | applied — incomparable is UNINTERPRETABLE, and it blocks |
| 8 | an empty bound set read as an applied dimension | important | applied — an empty bound set is an absence |
| 9 | the single-bound branch never read the bound's metric name | important | applied — the name is carried through; a bound naming no metric is UNINTERPRETABLE |
| 10 | the two legs' M-5 surfaces had different shapes and only the first row's record was kept | important | applied — both publish the same aggregated run-level counters |
| 11 | an admission refusal was counted as a failure, contradicting the report's own CM-3 | important | applied — the counter-metrics' terminal-state vocabulary is used |
| 12 | the model ids and prompt digests were copied with no comparison | important | applied — both carry a comparison state (identical / different / not recorded) |
| 13 | a null signed value crashed the report build (`.get('value', {})` returns the stored None) | important | applied — it records an absence |
| 14 | the control-vs-loaded regression was reported but never entered the verdict | important | applied — the criterion needs an AGREED regression tolerance; past it is a FAIL, absent it is BLOCKED |
| 15 | the request count was derived from the outcome tally, so the silent-failure check was dead | important | applied — the check needs an independent request count; without one it is NOT MEASURED |
| 16 | the two phases' request mixes were never compared | important | applied — a mismatch is recorded and blocks the verdict |
| 17 | the limits-lineage refusal was conditional on `--lineage` being supplied | nit | applied — a limits artifact that declares a lineage cannot be applied without one |
| 18 | the S4 checklist claimed M-1 was agreed while the branch's registry records it absent | nit | applied — the row now names MR !1063 as the pending carrier |
| 19 | three suite failures (`pydantic` missing in the reviewer's venv) | pre-existing | not a code defect — the suites are green with `pydantic` installed (353 + 214 + 24 tests) |

FIX-REVIEW round 1 (f=0, the correction diff only, fresh context): 12 of 19 verified fixed end-to-end, 5 partially fixed, 4 NEW defects (two able to flip the E02 verdict) — **NOT CLEAN**. All applied:

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| D1 | multi-turn rows silently dropped from the census and the coverage comparison (the class members were matched by raw row id; a turn row is keyed `<case_id>#t<n>`) | new defect | applied — the per-class row subsets are matched BY BASE ID, so a turn row lands in its case's class |
| D2 | the B leg counted a limit-hit row (`result_budget_exhausted`) as ANSWERED, inverting the coverage verdict | new defect | applied — a limit-hit row is counted apart (`continue`), matching the counter-metrics terminal state |
| D3 | the scope rule failed open on spelling ("config-A", "configuration A", "Config. A" were read as surface-neutral and applied to the wrong leg) | new defect / finding 3 | applied — the recognized spellings all name the configuration and transfer to NO other leg; a scope that mentions a configuration in a spelling the harness cannot parse names NO leg (UNINTERPRETABLE, the bound is not applied) |
| D4 | a regression FAIL computed over mismatched populations outranked the mix-mismatch BLOCK | new defect / finding 16 | applied — the regression verdict is BLOCKED when the phases cover different request mixes (the limits' own FAIL on the loaded phase's numbers still fails, correctly) |
| P2 | a measured C-leg bound FAIL was masked by a sibling bound the surface could not measure (the dimension status collapsed, and the verdict gated on the status) | partially fixed | applied — the failure is read off the BOUNDS, never off the dimension's status |
| P11 | the B branch still counted a limit-hit row as answered | partially fixed | applied (D2) |
| P15 | the record's own `n_without_terminal_outcome: 0` could mask a derived vanished-request count | partially fixed | applied — the derived count is the floor; a declared value can only raise it |
| P16 | the mismatch BLOCK sat in the last `elif`, so a FAIL won | partially fixed | applied (D4) |
| N1 | `_aggregate_cost` computed a per-counter `n_rows` it never published (the docstring promised it) | nit | applied — the aggregated surface publishes `n_rows_contributing` |
| N2 | e01 imported `CREDENTIAL_MARKERS`/`MEASUREMENT_KEY_NAMES` it no longer used after the move to `redaction.py` | nit | applied — the dead imports are gone |

Global review round 2 (on 58c0672f0, after the clean FIX-REVIEW): 3 important, 6 nit. All applied:

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| 1 | a config-B ABSTENTION counted as ANSWERED in the gains census (no `continue` after the abstention check), inflating the fixed pipeline's coverage and able to deny the agent a measured gain | important | applied — an abstention (or any non-empty abstention reason) is counted as an abstention and nothing else; the honest coverage test pins it |
| 2 | the differing-env comparison ran over the REDACTED maps, so equality could be claimed from a lossy view | important | applied — the comparison runs on the manifests' COMMITTED env maps (already top-level redacted at build time); redaction is display-only |
| 3 | the M-5 cost surfaces aggregated only answered/ok rows — a cancelled run's tokens are run cost | important | applied — both legs aggregate EVERY row carrying a usage record, naming the with/without split |
| 4 | the gains census silently excluded rows whose base id matched no set entry | nit | applied — `excluded_rows` (per leg, with ids) is in the gains record; the two deferred-work entries are marked resolved in this MR |
| 5 | the gains census and counter_metrics ordered the B terminal states differently | nit | applied — the census reads the states in the counter-metrics vocabulary's order |
| 6 | `protocol/redaction.py` was missing from the CLAUDE.md layout tree | nit | applied |
| 7 | a scope naming BOTH E02 legs ("config B and config C") resolved to ambiguous and could never apply | nit | applied — the scope parse returns the NAMED SET: a scope naming the pair's own legs applies to them; an unparseable mention still names no leg |
| 8 | boolean outcome values counted as requests in the coexistence load tally | nit | applied — the numeric readers reject bool, mirroring the rest of the module |
| 9 | the M-4 latency surface's counts did not reconcile (an answered row with a missing wall_ms appeared in neither count) | nit | applied — `n_answered_rows_missing_wall_ms` makes the population visible |

Global review round 3 (on a31fd48c4, after the clean FIX-REVIEW): 1 important, 8 nit. All applied:

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| 1 | the scope rule still failed open for leg-referential spellings WITHOUT the word "config" ("the B leg only", "scoped to C", "the A reference's metrics" were read as surface-neutral and gated BOTH legs) | important | applied — a scope is surface-neutral ONLY when it names no configuration at all: any standalone uppercase A/B/C token (case-sensitive on purpose, so the English article "a" does not block honest prose) or the bare word "config" outside the canonical spelling names a configuration the harness does not parse → UNINTERPRETABLE, applied to no leg |
| 2 | the resolved-env state could claim "identical" over the build-time-redacted maps, and over two empty maps | nit | applied — "identical" means identical over the recorded keys (the note says credential-named keys are not comparable); two empty maps are "not_recorded" |
| 3 | a mis-typed outcome tally count (a float or a string) was silently dropped, fabricating vanished requests | nit | applied — a non-integer non-bool tally count is a typed refusal (`invalid_measurement`), never a fabricated breach; a non-mapping outcomes value too |
| 4 | the promotion-decision evidence record claimed "verbatim" but was width-truncated mid-word | nit | applied — re-captured unwrapped, the header says so |
| 5 | the B census read the limit marker on the abstention-reason shape only; CM-3 reads the resource-record marker for both shapes | nit | applied — the B census reads BOTH shapes, pinned by a test |
| 6 | `cmd_e02` died with a traceback on a missing/unreadable `--set` file | nit | applied — OSError is caught beside SetValidationError → a typed refusal |
| 7 | the M-5 absence reason claimed "no usage_record" when the rows carried records with no cost counters | nit | applied — the two absences are distinguished, so the reason cannot contradict the report's own per_case rows |
| 8 | the admission-refusal rate divided by the terminal tally when the request count was unrecorded | nit | applied — the rate is not published over an unmeasured denominator; a note says why |
| 9 | the S4 exit-condition summary absorbed two of check 2's three opens | nit | applied — the exit condition names all of them (the thresholds artifact, the multi-hop/ambiguous set, #2145) |

FIX-REVIEW f=0 (chain 2, the diff 58c0672f0..484066a29, fresh context): all 9 round-2 fixes VERIFIED-FIXED, the merge clean (no branch protocol code touched by conflict resolution), the evidence records truthful, the suites green — and 2 new defects, NOT CLEAN. Both applied:

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| D1 | `_aggregate_cost` was defined TWICE (the fix ADDED a new def instead of replacing — the first fully shadowed, with a contradictory docstring) | new defect | applied — the shadowed copy is deleted |
| D2 | the bool-rejection fix was UNPINNED (no test fed a bool outcome/usage value; reverting it left the suites green) | new defect | applied — a test feeds a bool outcome and a bool counter value and pins both rejections; it exposed a third reader (`n_admission_refusals`'s tally derivation) still accepting bool, which is fixed too |
| obs | the C-side ordering divergence (cancelled checked before the limit marker), the mirror of the resolved B-side item | pre-existing | applied — the C branch reads the terminal states in the counter-metrics vocabulary's order (the limit marker first), pinned by a test |

Global review round 4 (on 184627aab): **scope drift** — invoked with the base branch as the review target, the reviewer read the umbrella planning artifacts (prd.md, epics.md, the sprint-status archival) instead of this MR's 21-file diff. 5 findings (1 important + 4 nit), all verified against `git diff --name-only origin/feat/agentic-foundations/prd..HEAD` to touch ZERO files of this MR. Disposition: out of scope for a story MR (the umbrella planning artifacts are the programme branch's own documents), recorded on the MR for the programme owner, never applied here — applying them would widen the story's contract. The round is counted (never reset); round 5 re-ran scoped to the MR diff.

Global review round 5 (on 184627aab, scoped to the MR diff): **0 important, 6 nit.** The reviewer confirmed the honesty bar holds (absent thresholds record absent, C abstention publishes no count, blocked never passes, the verdict reads B-vs-C) and the round-1..3 corrections all present and test-pinned. All 6 applied:

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| 1 | the M-3 surfaces still named a limit-hit row two different things: M-3.B counted a budget-exhausted row (abstained=True + reason=result_budget_exhausted) as n_abstained while the census pins it as n_limit_hit; M-3.C counted a budget-exhausted cancelled row in n_cancelled_rows | nit | applied — both M-3 tallies exclude the census's limit-hit rows and carry n_limit_hit themselves (one name per row on every surface), pinned by tests |
| 2 | a malformed thresholds artifact (a list, or a non-mapping value) crashed with AttributeError instead of a typed refusal; same for a non-mapping limits artifact | nit | applied — the shape is validated at the entry points (`invalid_thresholds` / `invalid_limits`), and the report-level scope read is defensive on a null dimension entry |
| 3 | the coexistence load record's cross-checks were asymmetric: an outcome tally EXCEEDING the request count was silently floored, and a declared n_admission_refusals overrode a higher tally | nit | applied — a tally exceeding the independent request count is refused (`invalid_measurement`); the declared refusal count can only RAISE over the tally, mirroring the vanished-request rule |
| 4 | the #2145 hold's population was mischaracterized: "10 answerable cases carry no gold" — the set has 10 empty-gold cases, 7 answerable-class | nit | applied — restated in the checklist (both lines), attempt.md and this story |
| 5 | the not_measurable reason blamed the measurement for a metric the harness does not define | nit | applied — an unknown metric name gets its own reason ("no legacy metric named … exists in this harness"), pinned by tests |
| 6 | the story's delivered-suite-size claim was stale (19+16 tests, 334 passed) | nit | applied — 54 + 33 tests, 391 protocol tests green |

FIX-REVIEW f=1 (chain 3, the diff 184627aab..96c926473, fresh context, mutation battery on every fix): all 6 round-5 findings VERIFIED-FIXED, every fix pinned by a failing test — and 3 NEW defects in the same one-name-per-row class, NOT CLEAN. All applied (54 e02 tests now):

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| D1 | the usage-record arm of the new M-3.B predicate was UNPINNED (deleting it left all 51 tests green) | new defect | applied — a test feeds the metadata.usage.outcome=budget_exhausted shape to M-3.B and pins n_limit_hit=1 |
| D2 | M-3.B's n_limit_hit scanned ok rows only while the census scans ALL rows: a failure row carrying the marker was n_failure_rows on the surface, n_limit_hit in the census | new defect | applied — the marker outranks the failure flag on the surface too (the classified tallies exclude census-classified limit hits; n_limit_hit scans every row), pinned by a test |
| D3 | M-3.C's n_answered_rows / n_admission_refused_rows / n_error_rows did not exclude limit-hit rows — a marked row was counted twice inside the surface | new defect | applied — the census's first-terminal-state rule applied to every tally on the surface (a marked row is n_limit_hit exactly once), pinned by a test |

FIX-REVIEW f=2 (the diff 96c926473..51cccd099, fresh context, 21/21 live census-agreement probes + row-sum invariants + mutation battery): D1/D2/D3 VERIFIED-FIXED — and 1 NEW nit, NOT CLEAN. Applied:

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| N1 | the n_error_rows exclusion arm on M-3.C was UNPINNED (dropping it left all 54 tests green) | new defect | applied — the exactly-once test feeds a marked error row too and pins n_error_rows=0 alongside the other tallies |

FIX-REVIEW f=3 (the diff 51cccd099..500bf46a5, fresh context, mutation re-run in a /tmp copy): N1 VERIFIED-FIXED, no new defects, 629 passed, worktree clean — **VERDICT: CLEAN**. The round-5 chain is closed: every M-3 tally speaks the census's name, every exclusion arm has a failing test, and the malformed-artifact/tally families are typed refusals.

## Design Notes

**Why the live E02 legs are refused, and what that does NOT mean.** The partial-order gate (story 4.1) refuses a gated B/C run until a SIGNED thresholds artifact exists, and story 4.4's `promotion_decision` produces that artifact only when every measured dimension (M-1..M-5) carries an agreed value. The operator's 2026-11-23 signature covers M-1 alone; M-2..M-5 stay explicitly absent. So the gate keeps refusing — and that refusal is the protocol working as designed (PRD §8: "an absent threshold blocks promotion rather than defaulting"), not a defect to route around. The live outcome of this story is therefore: the machinery ships, the refusal is recorded verbatim, and the live measurement waits on an operator decision nobody but the operator can make.

**The two absences the live campaign will hit, stated up front.**
1. *The multi-hop/ambiguous gains.* The PRD §4.1 note positions the agentic benefit on multi-hop and ambiguous queries. The live assessment set (16 cases) carries no such tagging and the protocol's composition classes do not include those classes; the set is frozen at digest `58850161afeb…` by the signed thresholds' lineage, so it cannot be extended without invalidating the signature. The E02 report therefore records those classes as NOT COVERED, with the reason — the gains the literature describes stay a hypothesis until a signed set carries them.
2. *The legacy limits.* NFR-3's criterion compares the legacy path against "agreed legacy latency/error/availability limits". Only the retrieval-quality bounds are agreed; M-4 (latency) is absent and error/availability have no dimension of their own in M-1..M-5. The coexistence verdict is therefore BLOCKED on the missing limits, with the limit named — never a default.

**The query-class tag's home.** The per-case query class is read from the case's `expectations.query_class` when present, falling back to the case's `case_class`. `expectations` is already a free-form per-case dict (`evalset.py:280`) — no schema change, no new field, and the composition floor is untouched. A set that wants multi-hop/ambiguous gains tags its cases; a set that does not is reported as not covering them.

**Why the coexistence criterion needs an AGREED regression tolerance.** The controlled comparison's own question is "did the legacy path degrade under the agentic load?" — the delta between the control and the loaded phase. Scoring a degradation needs a tolerance, and a tolerance nobody agreed is a default nobody chose: the legacy path's latency on a shared venue moves by noise, so "any degradation is a regression" would fail the criterion on the venue, not on the agent. The tolerance is therefore the operator's, recorded in the limits artifact next to the absolute limits (`regression: {<metric>: {max_delta: …}}`). Absent it, the regression is NOT MEASURABLE and the verdict is BLOCKED — the criterion never passes on an unmeasured comparison, and the deltas are in the report either way.

**Why the verdict is a comparison, not a score.** The layer computes no judgement: the gain is the judged dimension (M-2) and the judge owns it. What the layer can do is compare — the agent's leg against the fixed pipeline's leg, metric by metric, and bound by bound. So the verdict has exactly three states and each says what it measured: `not_supported` (a measured regression: the agent broke an applied bound, or its coverage fell below the fixed pipeline's), `supported` (every bound that could be applied to the agent's leg held, and the agent gained a class), `unassessable` (nothing was measurable — never a pass). A bound the FIXED pipeline breaks is recorded as the fixed pipeline's own state and never flips the agent's verdict: the E02 delta attributes to the agent, and only to the agent.

**Why the signed scope is acted on.** The registry's `scope` field is prose ("config A — the chunk/passage-level anchor metrics"), and the M-1 bounds it carries are chunk-level metrics the E02 legs never measure. Deciding applicability by metric NAME alone would apply a config-A bound to config C the moment a name happened to collide — the report would compare two different surfaces and call it a breach. So a scope that names a configuration applies to that configuration only, and the report records the bound as NOT APPLICABLE, with the scope quoted.

## Verification

**Commands:**
- `cd tests/rag-benchmarks && python3 -m pytest test_protocol_e02.py test_protocol_coexistence.py -q` -- expected: PASS (the new suites, fake seams only).
- `cd tests/rag-benchmarks && python3 -m pytest -q` -- expected: PASS (the whole protocol suite stays green).
- `cd tests/rag-benchmarks && python3 -m protocol.run_protocol e02 --help` and `... coexistence --help` -- expected: the two subcommands are registered.
- `python3 -m ruff check tests/rag-benchmarks/protocol/` -- expected: clean (the repo's lint lane).

**Manual checks:**
- The E02 report's `verdict` names the agentic benefit as a hypothesis unless a dimension's gain is measured against an agreed threshold — a positive verdict on unmeasured dimensions is a defect.
- The coexistence report contains BOTH phases' legacy latency/error/availability numbers in every verdict state.
