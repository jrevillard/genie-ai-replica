# S4 Exit Checklist — the agentic path (Epic 4's evidence bundle)

- **Artifact:** `s4-exit-checklist`
- **Gate:** stage S4 exit (PRD agentic-foundations) — evidence check, not a status report: every check below names the artifact that evidences it, and walking the checklist never leaves the epic's artifacts.
- **Rule (epic):** "S4 exit needs E01 + E02 + bounded execution + rollback demo + coexistence criterion" (issue #1981 AC 4). A check without its evidence recorded is an OPEN check — the stage does not exit.
- **Form:** the sibling of the S3 exit checklist (`docs/baselines/s3-exit-checklist.md`) — the same evidence table (check → evidence artifact → state). Every state below is read off a committed artifact, never asserted.

## The measured order (PRD §8) — what is still blocking

The partial-order gate refuses a gated B/C run until a **signed** thresholds artifact exists, and story 4.4's registry produces that artifact only when every measured dimension (M-1..M-5) carries an agreed value. The operator's signature of 2026-11-23 (MR !1063) covers **M-1 only** (the retrieval-quality bounds, against the measured config-A reference of issue #2118); M-2 (answer grounding), M-3 (abstention correctness), M-4 (latency) and M-5 (resource consumption) stay **explicitly absent**, and an absent dimension blocks promotion — it is never defaulted.

So the two gated legs (config B for E01, config B + config C for E02) and the joins that consume them are **refused by the protocol**, not missing by neglect. The refusals are recorded verbatim in the run directories below. The evidence that closes checks 1 and 2 is an operator decision on M-2..M-5, not a harness change.

| Dimension | Agreed? | Consequence for the S4 exit |
|---|---|---|
| M-1 retrieval quality | **YES — merged** (MR !1063, squash `9ca967274`, 2026-11-23/24): the five retrieval bounds are signed against the measured reference, and this branch carries the merged registry | the bounds are scoped to config A's chunk-level anchor metrics, and the scope is ACTED ON: a bound scoped to another configuration is recorded as not applicable, so the E02 legs (doc-level surface) are never measured against them |
| M-2 answer grounding | no | no answer-grounding bound can be applied to any leg; the E02 verdict stays unassessable on that dimension — and the promotion decision stays BLOCKED |
| M-3 abstention correctness | no | the same for the abstention dimension |
| M-4 latency | no | the coexistence criterion's legacy latency limit has no agreed value → the criterion's verdict is BLOCKED, never a pass |
| M-5 resource consumption | no | the agentic cost surface has no agreed bound; the reference records no resource surface at all on the venue |

**The gate state after !1063 merged** (`_bmad-output/implementation-artifacts/e02-attempt-2026-11-24/thresholds-promotion-refusal.txt`, verbatim): the sign-off IS signed (owner `jrevillard (ITU)`, 2026-11-23), M-1 carries the five signed bounds — and the promotion decision is still **BLOCKED**, because M-2..M-5 carry no agreed threshold. `derive_thresholds_artifact` refuses, so no signed thresholds artifact exists, and the gated B/C legs keep refusing (`missing_thresholds`) — the attempt's refusal records were re-produced on this branch after the merge, with the same reference manifest digest (`8dc67fa1804e`) the E01 leg was refused against.

## Check 1 — E01: behavior preservation (A vs B)

| Evidence | Artifact | State |
|---|---|---|
| The comparison layer (the A answer capture, the digest-pinned A-vs-B report, the typed refusals) | `tests/rag-benchmarks/protocol/e01.py` + `run_protocol.py capture-a` / `run_protocol.py e01` | Green (story 4.3) |
| The A-only reference measurement on the forge k3s | `_bmad-output/implementation-artifacts/e01-run-2026-11-23-forge/config-a.report.json` + `reference.manifest.json` (corpus `6c9f7371…`, set `58850161…`, 16 cases, 9 answered) | Recorded (issue #2118 / MR !1056) |
| The gated config-B leg | `_bmad-output/implementation-artifacts/e01-run-2026-11-23-forge/config-b.gate-refusal.txt` | **OPEN** — refused by the gate (`missing_thresholds`: the reference exists, no signed thresholds file references it) |
| The E01 join | `_bmad-output/implementation-artifacts/e01-run-2026-11-23-forge/e01.refusal.txt` | **OPEN** — refused (`missing_artifact`: the B-leg gated manifest does not exist) |
| The E01 report (`e01.report.json`) | — | **OPEN** — unreachable before the config-B leg runs; the refusal names the missing artifact |

## Check 2 — E02: the agent's case (B vs C)

| Evidence | Artifact | State |
|---|---|---|
| The comparison layer (the B-vs-C report: M-1..M-5 per leg, the gains per query class, the costs, the thresholds applied, the honest verdict) | `tests/rag-benchmarks/protocol/e02.py` + `run_protocol.py e02` | Green (story 4.5) |
| The pair conditions the delta rests on (retrieval backend, preparation and admission policy held fixed; orchestration the recorded intentional difference) | `tests/rag-benchmarks/protocol/pairs.py` (the E02 entry, pinned by `test_protocol_manifest.py`) | Green |
| The gated config-B and config-C legs | `_bmad-output/implementation-artifacts/e02-attempt-2026-11-24/config-b.gate-refusal.txt`, `config-c.gate-refusal.txt` | **OPEN** — refused by the gate (the same `missing_thresholds`: the reference exists, no signed thresholds file references it) |
| The E02 join | `_bmad-output/implementation-artifacts/e02-attempt-2026-11-24/e02.refusal.txt` | **OPEN** — refused (`missing_artifact`: the B leg's gated manifest does not exist) |
| The E02 report (`e02.report.json`) | — | **OPEN** — unreachable before the gated legs run |
| The multi-hop / ambiguous gains | the vocabulary carries the classes (`tests/rag-benchmarks/protocol/evalset.py`), and a CANDIDATE assessment set extends the signed reference by addition only (`_bmad-output/implementation-artifacts/assessment-set-candidate-2026-11-25/`) | **OPEN** — the agentic benefit the PRD §4.1 note describes stays a HYPOTHESIS: the candidate set is a proposal, and the path to measured evidence is the operator's — agree the set, re-sign the thresholds onto its digest, then re-run the legs |
| The gold annotations the C verdict needs | 10 of the assessment set's cases carry no gold annotation (empty gold), 7 of them answerable-class — issue #2145 | **OPEN** — a C verdict must not be composed before #2145 is handled: the agent's answers on the unannotable cases are not judgeable, and scoring them as if they were would massage the result |

## Check 3 — Bounded execution (V06)

| Evidence | Artifact | State |
|---|---|---|
| The runtime verification record (12 matrix completions, 2 cancellation demonstrations, 1 control call, 1 probe run — serial, read-only) | `docs/baselines/v06-runtime-verification-2026-11-21.md` | Recorded (story 2.2) |
| The re-runnable producer | `components/agent-service/measurement/v06_harness.py` (`python -m measurement.v06_harness`) | Green (`test:agent-service`) |

## Check 4 — Rollback demo (V08)

| Evidence | Artifact | State |
|---|---|---|
| The rollout record (the activation, the flag-off equivalence, the rollback rehearsal on the shared k3s dev cluster, the named trigger and the dedicated workloads' deletion proof) | `docs/rollouts/v08-rollout.md` | Recorded (story 3.3) |
| The rehearsal procedure | `docs/rollouts/v08-rehearsal-runbook.md` | Recorded |
| The per-stage re-run rule (every new serving surface re-runs the rehearsal at its own stage) | `docs/rollouts/README.md` | Recorded |

## Check 5 — Coexistence criterion (NFR-3)

| Evidence | Artifact | State |
|---|---|---|
| The controlled comparison (legacy-only vs legacy-under-agent-load), the agreed-limits application, the saturation/admission response and the computed verdict | `tests/rag-benchmarks/protocol/coexistence.py` + `run_protocol.py coexistence` | Green (story 4.5) |
| The live comparison on the venue | — | **OPEN** — needs the agentic path deployed on the venue and the operator's AGREED limits artifact. A DRAFT exists (`_bmad-output/implementation-artifacts/coexistence-limits-draft-2026-11-25/` — absolute limits + regression tolerance derived from the FINAL A/#2118 references, method documented); the harness refuses a draft artifact, so the verdict stays BLOCKED until the operator flips its status at agreement |
| The agentic load's saturation response (the admission lane refuses a saturated run with a 429 + `Retry-After`; it never queues) | `components/agent-service/noagent/lane.py` (`AdmissionLane` / `LaneBusyError`) | Recorded (the mechanism); the observed rate is part of the live comparison |

## Exit condition

S4 exits when checks 1–5 are green with their evidence recorded. Today:

- check 3 (V06) and check 4 (V08) are recorded;
- check 1 (E01) is OPEN on one predecessor — the signed thresholds artifact, which needs M-2..M-5 agreed (the operator's decision);
- check 2 (E02) is OPEN on THREE distinct predecessors: the same signed thresholds artifact, the multi-hop/ambiguous assessment set (the gains the PRD §4.1 note describes are otherwise not measurable), and the #2145 gold annotations (a C verdict must not be composed while 10 of the set's cases carry no gold, 7 of them answerable-class);
- check 5 (coexistence) is OPEN on the live comparison and on the operator's AGREED limits artifact — the draft (`_bmad-output/implementation-artifacts/coexistence-limits-draft-2026-11-25/`) proposes both halves (the absolute legacy limits AND the regression tolerance between the two phases) and the harness applies nothing until the operator agrees it.

The S4 exit is therefore **blocked on operator decisions, not on missing machinery**: the machinery (the E01 layer, the E02 layer, the coexistence criterion, the threshold registry) is delivered and green, and every gate that is still closed says which artifact is missing and who owns it. Nothing here is absorbed silently.
