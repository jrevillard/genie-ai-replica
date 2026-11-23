---
title: 'Story 4.3 — E01: behavior preservation (A vs B)'
type: 'feature'
created: '2026-11-22'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '3916dd46c4533ce530818f7e774c7093c11711de'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-genie-ai-2026-11-16/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — the issue #1979 acceptance criteria, operator-authored">

## Intent

**Problem:** Story 4.1's harness runs the E01 legs (the A-only reference, the gated B run) but nothing compares them: no artifact reports M-1..M-5 per configuration, uncontrolled differences go unidentified, FR-26 has no recording mechanism (a known reference defect would silently become a requirement B must reproduce), and no versioned, reproducible A-vs-B report exists. Config A also lacks the answer/abstention/latency surfaces the comparison needs — the anchor path is trace-only.

**Approach:** Add the E01 comparison layer to the protocol package: an A answer-capture driver (reusing `run_eval.drive_query` verbatim, timed at the protocol layer — `eval/` stays untouched so `harness_sha` holds); a lineage-verified reference-defects ledger artifact (campaign-authored, the thresholds pattern); and the `e01` report — a pure, digest-pinned join of the A anchor report, A captured rows, B rows and both run manifests into per-dimension M-1..M-5 records with an uncontrolled-differences section. CLI: `capture-a` and `e01` subcommands.

## Boundaries & Constraints

**Always:**
- Every input artifact is digested into the report's inputs record; the report is a pure function of its inputs plus a pinned `created_utc` — same inputs and pin produce an identical digest (the reproducibility AC).
- M-1..M-5 are each reported for BOTH configurations with the measurement surface named; a surface a config cannot provide (B has no chunk-level retrieval surface; A anchor rows carry no resource fields) is recorded as not available with the reason — never invented, never silently dropped.
- Uncontrolled differences are identified from recorded evidence: prompt digests and model ids from the two manifests, execution-condition facts (sequential anchor pass vs batched B lanes, seed), cache state recorded as unrecorded-by-the-harness (FR-27).
- The defect ledger is lineage-verified (corpus fingerprint + set digest + reference-manifest digest) before application; its case ids carry `reference_defect` in the per-case records; a ledger ABSENT is recorded as absent — A failures then stand as plain comparison results (FR-26: a defect is recorded, never silently a requirement).
- Refusals are typed and precede any report building: corpus/set lineage mismatch between the legs, a config-C manifest on the B leg (C belongs to E02), a missing leg artifact (anchor report, captured rows, B rows, either manifest).
- No credentials anywhere in the report (the manifest redaction surface reused).

**Never:**
- No modification under `eval/` or `capture_baseline.py`: `harness_sha` is the reuse identity — the A capture imports `run_eval.drive_query`/`_extract_answer`, never edits or forks them.
- No change to the noagent pipeline, agent-service, budgets, admission, the partial-order gate or thresholds handling (story 4.4 owns the numbers; this story owns none).
- No new runtime dependency (stdlib-only driver side).
- No deployment case content authored: fixture rows only.
- No judging in code: M-2/M-3 verdicts belong to the judge layer under the versioned evaluator instructions; the report carries the judgment inputs (answers, abstention facts, sources), not verdicts.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| capture-a, fake query seam | valid assessment set | per-case captured rows: answer, http_status, wall_ms, response source/citation fields when present; multi-turn `case#t{n}`; atomic `config-a.captured.json`; resume ships only missing ids | per-case http_error/failure row recorded, run continues |
| e01, consistent legs | same corpus+set; reference manifest (A) + gated manifest (B); anchor report, captured rows, B rows present | `e01.report.json`: M-1..M-5 per config with measurement surfaces, `uncontrolled_differences`, digested `inputs`, reference-defects section, digest | typed refusal naming the missing artifact |
| e01, lineage mismatch | corpus fingerprint or set digest differs between legs | refused before building, naming the mismatch | typed refusal, exit 1 |
| e01, wrong-leg manifest | B-leg manifest is kind gated config C | refused (C belongs to E02) | typed refusal |
| e01, ledger absent | no reference-defects file | report records the ledger absent; A failures stand as plain results | N/A |
| e01, ledger applied | lineage-verified ledger | defect case ids marked `reference_defect`; ledger digest recorded | lineage-mismatched ledger refused before build |
| e01 reproducibility | same inputs rebuilt | identical digest under the pinned `created_utc` | N/A |

## Code Map

**Reuse (do not reinvent):**
- `tests/rag-benchmarks/protocol/drivers.py` — the driver pattern to extend: `run_config_a` (:174-215, subprocess + fail-fast `DriverError`), fakeable seams (`UrllibRunStream`, `DockerExecBTransport`), `turn_entries` multi-turn handling, B row shapes (config_b_driver.py :113-143: `wall_ms`, `abstained`, `abstention_reason`, `source_documents`, `metadata`).
- `tests/rag-benchmarks/protocol/manifest.py` — `build_manifest`, `manifest_digest`, `sha256_json` canonical digest (:70-73), `redact()`.
- `tests/rag-benchmarks/protocol/gate.py` — the `thresholds_file` assembler + lineage-verification pattern (:72-93, :146-157); the ledger mirrors the artifact kind / corpus / set / reference-digest field shape.
- `tests/rag-benchmarks/protocol/findings.py` — `build_findings_report`/`report_digest`: artifact header + honest-evidence statement precedent.
- `tests/rag-benchmarks/protocol/verdicts.py` — terminal-row reader `row.get("outcome", row.get("status"))` (:403); where abstention fields live.
- `tests/rag-benchmarks/eval/run_eval.py` — `drive_query(entry) -> (start, body, status)` (:227), `_extract_answer` (:271) — imported verbatim.
- `tests/rag-benchmarks/eval/harness.py` — atomic `write_json`.
- `tests/rag-benchmarks/capture_baseline.py` — the capture machinery (`compute_triples` :139-159) read for its statistics only: its tolerance band is clamped to [0, 1] (written for normalized metrics), so M-4 computes its own in-unit stats and publishes NO band.
- `tests/rag-benchmarks/protocol/evalset.py` — `load_set(kind="assessment")`, `turn_entries`.
- `tests/rag-benchmarks/protocol/run_protocol.py` — subcommand conventions (typed refusal exit 1, usage exit 2), `_validated_entries`.
- `tests/rag-benchmarks/protocol/pairs.py` — `CONFIG_PAIR`: B=E01, C=E02 (the wrong-leg refusal reads this).
- `.gitlab-ci.yml:4503` — the protocol pytest line gains `test_protocol_e01.py`.

**Facts (not to re-derive):**
- Anchor report top-level keys: `per_query`, `aggregate` (recall, precision, complete_recall, noise, retrieval_recall, recall@1/3/5/10, ndcg@1/3/5/10), `n_missed_traces`, `n_unmapped_chunk_keys`; per-query rows carry NO timing.
- A rows (`config-a.rows.json`) are security-skip rows only — no metrics, no timing.
- B rows carry `wall_ms`, `abstained`, `abstention_reason`, `source_documents`, `metadata`; no chunk-level retrieval surface (noagent contract is doc-level).
- No chunk-level retrieval on B is reachable without a noagent contract change — forbidden; M-1's B side is the recorded doc-level surface + judged answer dimensions.
- The ledger is not gated: defects are recorded knowledge, not a run precondition; thresholds remain the gate.

## Tasks & Acceptance

**Execution:**
- [x] `tests/rag-benchmarks/protocol/drivers.py` — add `run_config_a_capture`: fakeable query seam (default wraps `run_eval.drive_query` + `_extract_answer`, imported in-function), per-case rows (`case_id`, `status` ok|http_error, `answer`, response source/citation fields when the response carries them, `http_status`, `wall_ms` monotonic-timed, `turn`), failure rows recorded run-continues, resume, atomic `config-a.captured.json`.
- [x] `tests/rag-benchmarks/protocol/e01.py` — NEW: `reference_defects_file` assembler + `verify_defects_lineage`; `M_DIMENSIONS`; `build_e01_report` (M-1..M-5 per config with measurement surfaces, `uncontrolled_differences`, defect application, digested inputs, honest header, digest); typed `E01Refusal`.
- [x] `tests/rag-benchmarks/protocol/run_protocol.py` — `capture-a` and `e01` subcommands (validated set; e01 lineage checks → build → write `e01.report.json` + summary print).
- [x] `tests/rag-benchmarks/protocol/evaluator-instructions.md` — E01 judging section: dimensions apply to both configs' captured answers; B abstention mechanical field; A abstention judged from the answer text; the measurement-surface asymmetry stated.
- [x] `tests/rag-benchmarks/test_protocol_e01.py` — every matrix row through fakes (fake query seam, temp dirs, synthetic manifests/reports/rows).
- [x] `.gitlab-ci.yml` — protocol pytest line extended with the new test file.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` — story entry to `review` (at completion).

**Acceptance Criteria:**
- Given the A reference artifacts (anchor report + captured answers) and the gated B artifacts for the SAME corpus + set, when `e01` runs, then `e01.report.json` reports M-1..M-5 separately per configuration, each with its measurement surface named, and the uncontrolled-differences section identifies prompts (digests), model services (ids), execution conditions, cache state (recorded as unrecorded) and the retrieval measurement-surface asymmetry (FR-27).
- Given a known reference defect, when the ledger records it against the reference manifest, then the E01 per-case records carry `reference_defect` for that case and B's result there is reported in defect context — never silently a requirement to reproduce; with no ledger, the report records its absence (FR-26).
- Given the same input artifacts, when the report is rebuilt under a pinned `created_utc`, then the digest is identical — the report is versioned (artifact, version, input digests) and reproducible from the harness.
- Given mismatched lineage, a config-C manifest on the B leg, or a missing leg artifact, when `e01` runs, then it refuses before building, naming the offense.
- Given `capture-a`, when it runs on the venue, then per-case A answers, abstention-fact inputs and wall_ms exist — the M-2/M-3/M-4 surfaces for config A — with no edit under `eval/` (`harness_sha` stable).
- Given the component tree, when the rag-benchmarks suites run in CI, then all are green including `test_protocol_e01.py`.

## Implementation Notes

**Delivered (2026-11-23, branch `feat/agentic-foundations/4-3-e01-behavior-preservation-a-vs-b`).**
New `tests/rag-benchmarks/protocol/e01.py` — the reference-defects ledger
(`reference_defects_file` / `verify_defects_lineage`, the thresholds field
shape), `M_DIMENSIONS`, and `build_e01_report`: a pure, IO-free join of the A
anchor report, A captured rows, B rows, both run manifests and the optional
ledger into M-1..M-5 records (each naming its measurement surface, unavailable
surfaces recorded WITH their reason), an `uncontrolled_differences` section
(prompt digests + model ids from the manifests, execution conditions, cache
state recorded as unrecorded, the retrieval-surface asymmetry), per-case
judgment inputs with the `reference_defect` flag, digested `inputs`, and a
canonical-JSON `digest` recomputable via `e01_report_digest`.
`protocol/drivers.py` gains `run_config_a_capture` — a fakeable query seam
(default wraps `run_eval.drive_query` + `_extract_answer`, imported
in-function), per-case rows (`answer`, `http_status`, `wall_ms` monotonic at
the protocol layer, the response's source/citation fields only when the
response carries them), per-case failure rows with the run continuing, resume
over the missing ids only, atomic `config-a.captured.json`.
`protocol/run_protocol.py` gains `capture-a` and `e01`; `E01Refusal` maps to
the typed refusal exit 1. `evaluator-instructions.md` gains the E01 judging
section. `tests/rag-benchmarks/test_protocol_e01.py` — 43 tests, every matrix
row through fakes. CI: the protocol pytest line gains the new file.

**Decisions:**
- The E01 report is a separate artifact, not a manifest: it joins TWO runs, so
  it names its own version and digests its inputs rather than stamping a run.
- The CLI takes explicit artifact paths (no out-dir scan like the gate's) —
  each refusal then names the artifact that is missing.
- The ledger is not gated: defects reshape interpretation, thresholds gate the
  run. A ledger path that does not exist refuses (exit 1); "absent" means the
  flag was omitted.
- M-5 for config B is READ from the rows' metadata (usage/resource/cost keys,
  never a credential-named key), not asserted absent — the report states what
  the data carries.

**Verification (this session):** `pytest test_capture_baseline.py
test_protocol_evalset.py test_protocol_manifest.py test_protocol_gate.py
test_protocol_reuse.py test_protocol_drivers.py test_protocol_security.py
test_protocol_e01.py` → 222 passed; `cd eval && pytest -q` → 196 passed;
`python3 -m py_compile protocol/*.py` clean; `ruff check --config
components/agent-service/pyproject.toml protocol/ test_protocol_e01.py` clean.
The test env needs `requests` (the `capabilities.contract` import chain) plus
pydantic/openpyxl — without `requests` the B-driver helper test fails on an
import, not on a defect.

**Two findings from the implementing agent's own diff review, fixed here:**
(1) the manifest's redaction is top-level only, so a row's nested `metadata`
could carry a credential into the report — the E01 report now redacts at every
depth (the manifest's own marker list); (2) M-5 for config B asserted the
absence of a resource record instead of reading the rows — it now reports what
the rows carry.

**Known limits (honest):** `capture-a` against a live venue is unproven in
this environment (no docker on this host): the seam contract, resume,
atomicity and failure handling are covered by fakes, and the real
`drive_query` path needs one venue run. The ledger is campaign-authored (no
authoring CLI) — the harness verifies and applies it, it never invents defect
content. M-2/M-3 verdicts are deliberately the judge layer's: the report
carries the judgment inputs, never verdicts. The V03 deployment record
(`docs/baselines/v03-deployed-baseline-*.md`) is the campaign's reference for
the venue; the report carries the deployment identity through the two legs'
run manifests.

## Spec Change Log

## Review Triage Log

**Global code-review (C1) on `7ab20981f` — 14 findings, every claim verified
against the tree, all fixed.** The report's own contract is what the findings
attack (a comparison that claims more than it measured), so each fix tightens
a stated invariant rather than adding machinery.

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| 1 | M-5 copied config-B metadata values verbatim — a nested credential survived the top-level screen | important | **Fixed**: every recorded value goes through the depth-aware redaction |
| 2 | The gated manifest's `lineage.reference_manifest_sha256` was never compared with the passed reference — A from one reference run could be paired with B gated against another | important | **Fixed**: the B leg must be gated against THIS reference manifest |
| 3 | Two manifests without a fingerprint compared equal (None == None) — the lineage claim was vacuous | important | **Fixed**: lineage must be present on both sides |
| 4 | `prompt_digests.identical` / `model_ids.identical` were computed from maps the CLI never fills — equality claimed from absence | important | **Fixed**: an unrecorded side reads `not_recorded`, never `identical` |
| 5 | `compute_triples` clamps its tolerance band to [0, 1] — the millisecond latency band came out inverted | important | **Fixed**: M-4 publishes min/median/max/MAD in ms and NO tolerance band (the thresholds are story 4.4's) |
| 6 | The capture dropped chatqna's own `metadata.abstained` / `abstention_reason`, and the instructions claimed config A has no mechanical abstention field | important | **Fixed** (chatqna's `_mark_abstention` verified in the overlay): the facts are captured when the response carries them; the instructions describe the capture |
| 7 | The capture queried the set's SECURITY cases — the scenarios the protocol declares inapplicable to config A | important | **Fixed**: the security cases are recorded as skipped rows with story 4.2's reason — no live query at a surface that cannot resist |
| 8 | The A leg filtered on the entry's category/service labels while the B lane filters on the case context's `requested_labels` — the report presented a scope-matched comparison | important | **Fixed**: the capture records the labels it sent and the cases whose `requested_labels` never reached the A query; the report names the difference |
| 9 | The capture artifact carried no set digest or corpus fingerprint — a capture over another set could join | important | **Fixed**: the capture stamps both and the join verifies them against the manifests |
| 10 | A list-shaped defects file raised `AttributeError` — a traceback instead of the typed refusal | important | **Fixed**: the ledger's shape is checked before its keys are read |
| 11 | M-3's B record carried no failure count — a B leg that produced no answer read as zeros | important | **Fixed**: `n_ok_rows` and `n_failure_rows` on both sides |
| 12 | A config-C rows file passed as the B leg was silently filtered to an empty leg | nit (real) | **Fixed**: the row vocabulary is checked per leg |
| 13 | The redaction dropped measurement names (`chunk_key`, `prompt_tokens`) on one path while keeping them on another | nit (real) | **Fixed**: an explicit measurement-name allowlist, applied on every path |
| 14 | The recorded seed was operator-declared and never cross-checked | nit | **Fixed**: the seed is recorded as declared-and-unverified |

**FIX-REVIEW (f=0) on the C1 correction diff — 13 findings, every claim
mutation-verified (the reviewer reverted each fix in isolation), all fixed.**

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| F1 | The capture stamp certified the set FILE, not the rows' provenance — a capture over set B in a directory holding set A's rows joined set B's comparison carrying set A's answers | important | **Fixed**: a prior rows file stamped over another set or corpus refuses the resume |
| F2 | A converged resume never persisted the stamp while the CLI printed one | important | **Fixed**: the stamp lands on disk before the first query |
| F3 | The M-5 nested-credential fix had no test (the correction could be reverted with the suite green) | important | **Fixed**: a test asserts the M-5 values are deep-redacted and the measurement names survive |
| F4 | The "capture carries no stamp" refusal was unreachable by test | important | **Fixed**: a stamp-less capture is tested |
| F5 | The M-3 counters (and the A-side abstention counters) were unasserted — four mutations survived | important | **Fixed**: both sides' ok/failure/abstention counters are asserted |
| F6 | The A-leg half of the row-vocabulary check was untested | important | **Fixed**: a config-C rows file passed as the A leg is tested |
| F7 | The CLI synopsis omitted the now-required `--corpus-fingerprint` | low | **Fixed**: the synopsis carries it |
| F8 | The story still claimed the `compute_triples` reuse the correction removed, and the old test count | low | **Fixed**: both updated |
| F9 | The corpus half of the stamp was an operator declaration recorded as a verified fact (the seed got the opposite treatment) | important | **Fixed**: `inputs.capture_stamp.verified` states the set digest is computed and the corpus fingerprint is declared |
| F10 | `labels_sent_per_case` recorded labels for rows that queried nothing (failed / skipped) | important | **Fixed**: the scope is recorded on the queried (ok) rows only |
| F11 | Two credential vocabularies (manifest vs report) diverged in both directions | medium | **Fixed**: the divergence is deliberate and stated — the report keeps the measurement names the judge needs, and applies its own rule on every path it writes |
| F12 | The capture's field typing had a dead branch (both arms identical) and two structures that could drift | low | **Fixed**: one dict drives both |
| F13 | The instructions called a skipped A row "not a comparison case" while the report counted it | medium | **Fixed**: the report marks the skipped rows (`skipped` flag, `counts.skipped_cases`) and the instructions say the judge excludes them |

## Design Notes

**Why capture-a is a separate command, not part of `reference`.** The anchor runs as one whole-set subprocess (per-case timing and answers are invisible from outside it, and editing `run_eval.py` would break `harness_sha`). The protocol layer times and captures per case by importing the query function; the reference command stays exactly the artifact story 4.4 consumes.

**Why the ledger is not gated.** Thresholds gate because a candidate assessment without them compares against nothing. Defects are recorded knowledge that reshapes INTERPRETATION; the report states which ledger (digest) was applied, or that none was — the honest-interpretation invariant without a second gate.

**Why measurement surfaces are named per dimension.** A and B expose different surfaces by construction (the retrieval backend IS the variable under test): A retrieval is chunk-level (anchor), B retrieval is doc-level (`source_documents`); A abstention is judged from the answer text, B's is a mechanical field. A comparison that hid the asymmetry would manufacture false equivalence — the report names the surface under every dimension.

## Verification

**Commands:**
- `cd tests/rag-benchmarks && pytest test_capture_baseline.py test_protocol_evalset.py test_protocol_manifest.py test_protocol_gate.py test_protocol_reuse.py test_protocol_drivers.py test_protocol_security.py test_protocol_e01.py -q` — expected: all green
- `cd tests/rag-benchmarks/eval && pytest -q` — expected: existing suites green (except the recorded pre-existing fanout flake)
- `cd tests/rag-benchmarks && python3 -m py_compile protocol/*.py` — expected: clean
- `ruff check tests/rag-benchmarks/protocol/` (agent-service config; fallback `py_compile` stands in per 4.1 precedent) — expected: clean
