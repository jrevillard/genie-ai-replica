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
judgment inputs with the `reference_defect` and `skipped` flags, digested `inputs`, and a
canonical-JSON `digest` recomputable via `e01_report_digest`.
`protocol/drivers.py` gains `run_config_a_capture` — a fakeable query seam
(default wraps `run_eval.drive_query` + `_extract_answer`, imported
in-function), per-case rows (`answer`, `http_status`, `wall_ms` monotonic at
the protocol layer, the response's source/citation/abstention fields only when the
response carries them), per-case failure rows with the run continuing, resume
over the missing ids only — a prior rows file that carries cases without a stamp,
or with a stamp over another set or corpus, REFUSES the resume — atomic
`config-a.captured.json` stamped with the assessment-set digest and the corpus
fingerprint.
`protocol/run_protocol.py` gains `capture-a` and `e01`; `E01Refusal` maps to
the typed refusal exit 1. `evaluator-instructions.md` gains the E01 judging
section. `tests/rag-benchmarks/test_protocol_e01.py` — 65 tests, every matrix
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
test_protocol_e01.py` → 244 passed; `cd eval && pytest -q` → 196 passed WITH
openpyxl installed, 186 passed + 1 skipped without it (the module-level skip drops
the ten test functions of `test_enrich_xlsx_v2.py`) — and the eval suite is
ORDER-FLAKY in `eval/test_fanout_parity.py` (pre-existing, recorded in story 4.1:
the call-order assertion `gen-1,gen-2,gen-3` depends on the iteration order, so
some runs report 1 failed / 195 passed);
`python3 -m py_compile protocol/*.py` clean; `cd tests/rag-benchmarks && ruff check
--config ../../components/agent-service/pyproject.toml protocol/
test_protocol_e01.py` clean (ruff 0.16.3 pinned). The lint invocation is cwd-sensitive
— from the repository root the same config reports I001 for the protocol test tree
(story 4.1's and 4.2's files AND this story's `test_protocol_e01.py`), so the
benchmark-relative form is the one that holds. The CI lane for this tree is pytest
only (`.gitlab-ci.yml` `test:rag-benchmarks`): there is no ruff lane and no
compile job over `tests/rag-benchmarks`.
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

**Quality phase — /simplify over the full story diff (four angles: reuse,
simplification, efficiency, altitude; 35 raw findings, deduplicated): 19
applied, 16 skipped with reasons.** The applied ones (all mechanical, all
covered by the suite): the credential markers are derived from the manifest's
list instead of a copy; the latency statistics reuse the capture machinery's
`median`/`mad` (one 1.4826 scaling in the tree); the M-5 resource surface is a
NAMED key (`usage`) instead of a substring zoo; the report's comparison runs
on the RAW maps and only the emitted copies are redacted; the capture file is
ONE input (its rows and its stamp cannot be paired from two captures); the
turn-id grammar is parsed by one helper (`evalset.base_case_id`); the capture
records the EFFECTIVE filter chatqna applied and the report compares the two
legs' effective scopes (`scope_matched` is a measured fact now); the capture
reuses the shared corpus arguments, so the corpus fingerprint can be MEASURED
(`--compute-fingerprint`) instead of only declared; the row merge carries the
envelope keys generically; the skip row is built in the capture's own
vocabulary; the wall clock is measured once; the rows file is updated in place
(no full-dict copy per case); the redaction no longer deep-copies twice; the
report's lineage is derived by one helper; the dimensions are built from
`M_DIMENSIONS`; the latency surfaces are two direct calls; the capture's
refusal is one loop over the two stamp fields; the story's stale claims (the
counts, the lint invocation, the CI-lane claim) are corrected.

Skipped with reasons: the shared credential rule in `manifest.redact` (4.1's
surface — deepening it changes every manifest digest, and the thresholds
lineage story 4.4 signs against those digests); a shared lineage-artifact
module (a third family belongs to story 4.4's decision, not this story's
machinery); the capture inside `run_eval`'s own loop (it would change
`harness_sha` — the reuse identity — so the venue requirement is documented
in the capture's docstring instead); the shared test fixtures in a
`conftest.py` (it would touch story 4.1's and 4.2's test files, outside this
diff); the per-case JSON re-parse in the seam (the seam contract stays
simple — the cost is microseconds per case); the repeated row passes in the
dimension builders (readability over a few milliseconds at 1000 cases); the
`available` flag, the refusal base class, the CLI loader table and the counter
helpers (each would make the code less readable for no behavioural gain);
the per-case rows-file rewrite (the same pattern the B and C drivers use — the
write stays, the dict copy is gone).

**Deferred (not this story's defect):** the run manifest records
`model_ids` and `prompt_digests` unredacted (story 4.1's surface). The E01
report redacts what it copies, but a credential-named key inside a manifest
map would still reach the committed manifest — filed as an issue and recorded
in `deferred-work.md`.

**Test audit (the story's test surface: `test_protocol_e01.py` + the
protocol package it exercises).** One finding, fixed: the measurement-name
rule was asserted through the private `_redact_deep` helper — a
private-predicate test. It now asserts the same contract at the REPORT
boundary (the declared measurement names reach the report, a token count
outside the allowlist survives, a token credential does not), which is where
the judge reads it. Retained with reasons: the fake query seam (it IS the
capture's boundary — the seam contract is what the fakes exercise); the
default-seam test (it pins the `run_eval` reuse, which is the
capture-artifact reuse identity); the mid-run rows-file probe (it pins a
deliberate decision — the stamp lands with the first written case, not
before); the fixture rows (synthetic, no deployment case content); the
composition-valid set builder (the composition floor is enforced on the data
path, so the fixture must satisfy it). The duplication of the case/set
helpers with story 4.1's and 4.2's test files is real but belongs to a
shared `conftest.py` extraction across those files — outside this diff, and
recorded in the simplify phase's skipped list.

| F30' | The credential rule kept any `_tokens` name — `password_tokens` reached the report | important | **Fixed**: a `_tokens` name is a count only when it carries no credential marker; the TOKEN marker itself is the suffix |
| F31' | The "requested labels never reached the A query" check fired only on an EMPTY request, not on a label the filter never carried | important | **Fixed**: the requested labels are checked against the filter that was applied |
| F32' | The capture's seam inherited NONE of run_eval's bearer handling, while the docstring claimed the anchor behaved the same | important | **Fixed**: the seam mirrors the anchor's path (a TTL refresh before the drive, a forced refresh + one re-drive on 401/403) |
| F33' | `scope_matched` was published over the intersection only — a partial comparison read as a full one | important | **Fixed**: the compared and scoped counts are published, and the verdict is null unless every scoped case was scoped on both legs |
| F34' | The label coercion split a string-valued `categoryLabels` into characters — the repo's documented pitfall | important | **Fixed**: a bare string is ONE label |
| F35' | The A leg's wall clock covered the response parse, while B's covers the pipeline only | nit | **Fixed**: the clock covers the seam call, like the B leg's |
| F36' | The effective-label maps were written unredacted | nit | **Fixed**: they go through the redaction like every other map |
| F37' | The `capture-a` synopsis omitted the required `--corpus-collection` | nit | **Fixed**: the synopsis carries the full argument shape |
| F38' | The story's counts were stale | nit | **Fixed**: 64 tests / 243 passed |
| F39' | The benchmarks knowledge file's Layout tree did not mention the protocol package | nit | **Fixed**: the tree lists the package, its modules and the protocol test suite |

**Global code-review (C2) on the delta since C1 — 10 findings (4 important, 6
nit), every claim verified, all fixed.** The four important ones were holes in
the report's own honesty: a credential-named key that survived the rule, a
missing-label check that never fired, a capture that would 401 where the
anchor answers, and a scope verdict published over a partial comparison.

| F40' | The label-coercion test used a hardcoded `/tmp` path — the capture's resume reused the stale rows file, so the fix was defeated (and the correct code could fail) | important | **Fixed**: the test uses `tmp_path`, so the capture starts from an empty out-dir |
| F41' | The capture's docstring still claimed the seam had no token refresh — the opposite of the code | important | **Fixed**: the docstring states the seam's TTL refresh, the forced refresh and the one re-drive, and the one thing it does NOT mirror (the anchor's transient retry) |
| F42' | The redaction wrappers on the effective-label maps were a no-op (a list of strings) and implied protection they did not give | important | **Fixed**: the wrappers are gone; the comment states the real invariant (the effective filter is a list of label strings) |
| F43' | The key `cases_whose_requested_labels_never_reached_the_A_query` overstated what it compares (the EFFECTIVE filter — chatqna collapses a category into its service) | important | **Fixed**: the key states what it compares, and the instructions explain the collapse |
| F44' | The scope note said null means partial, while an observed mismatch published false over a partial comparison | important | **Fixed**: the note states that an observed mismatch publishes false even over a partial comparison |
| F45' | The label coercion existed only on the write side — a string in a captured file was split into characters on the read | important | **Fixed**: one shared coercion (`evalset.as_label_list`) serves both sides |
| F46' | The protocol's coercion returned `[""]` for an empty label, while the server treats an empty label as no scope at all | important | **Fixed**: the shared coercion mirrors the server's rule |
| F47' | The wall-clock fix was uncovered | nit | **Fixed**: a test stubs the clock and pins the seam-only delta |
| F48' | A bare `auth` / `session` key passed the credential rule (pre-existing, outside the diff) | nit | **Fixed**: the report's marker set covers them |

**FIX-REVIEW (chain round 1) on the C2 correction diff — 8 findings (seven
in-diff, one pre-existing residual), all confirmed, all fixed.** The
reviewer's mutation matrix confirmed the C2 fixes themselves (the credential
rule, the requested-label check, the bearer path, the scope comparison); the
findings were the corrections' own edges — a stale-artifact test, a docstring
that contradicted the code, a no-op "protection", an overstated key name, a
note that contradicted the code, and a coercion that lived on only one side.

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

**FIX-REVIEW (f=1) on the f=0 correction diff — 9 findings (four of them showed
the previous fixes were not covered), all fixed.** The reviewer mutation-tested
each fix; the four "survived" mutations are what this round closed.

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| F2' | The stamp-on-disk fix was untested (a converged resume's stamp came from the loop's write, not the pre-loop one) | not confirmed | **Fixed**: a stamp-less rows file with rows now REFUSES the resume, and a converged resume over a stamped file keeps that stamp — the pre-loop write is gone as dead code |
| F1' | The resume refusal did not fire when the prior file carried cases but no stamp — exactly the file shape the earlier code left behind | not confirmed | **Fixed**: rows without a stamp refuse the resume |
| F10' | The scope restriction had no test, and it dropped the FR-27 naming for the cases that never queried | not confirmed | **Fixed**: the scope is recorded only on the queried rows, the cases that never queried are named (`cases_that_never_queried`), and both are tested |
| F11' | "One credential rule on every path" was false — the M-1 aggregate and the recorded label scopes were written unredacted | not confirmed | **Fixed**: both go through the redaction; the module docstring states the rule and the paths it covers |
| F5' | The module docstring still described the manifest's rule (the opposite of the code after F11) | confirmed | **Fixed**: the bullet names the report's own rule, the measurement exceptions and the paths |
| F6' | `run_config_a_capture`'s docstring was stale (no resume refusal, no stamp, scope not mentioned) | confirmed | **Fixed**: the docstring carries all three |
| F7' | Only the set half of the resume refusal was tested | confirmed | **Fixed**: the corpus half is tested too |
| F8' | The story's eval-suite count and ruff sentence were stale | confirmed | **Fixed**: both re-measured and stated with their env caveat |
| F9' | The Implementation Notes omitted the `skipped` flag, the resume refusal and the abstention facts | confirmed | **Fixed**: all three are in the paragraph |

**FIX-REVIEW (f=2) on the f=1 correction diff — 11 findings (every claim
confirmed by the reviewer), all fixed. This round spent the fix chain's budget
(F=3), so the corrections below are locally verified but NOT re-reviewed — the
seat parks awaiting the operator's decision.**

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| F10' | The M-1 redaction dropped `n_unmapped_chunk_keys` — the marker `key` matched the counter's own name | confirmed | **Fixed**: the anchor's evidence counters are whitelisted, and a test pins it |
| F11'' | The capture stamp was spread verbatim into `inputs` — the one write path the credential rule had left open | confirmed | **Fixed**: the stamp goes through the redaction |
| F12' | The manifests' `prompt_digests` / `model_ids` were copied verbatim into the uncontrolled-differences section | confirmed | **Fixed**: both maps are redacted before the comparison |
| F13' | `cases_that_never_queried` named an ANSWERED case that merely carried no scope | confirmed | **Fixed**: the two cases are split — a non-ok row is never-queried, an ok row without a scope is `cases_without_a_recorded_scope` |
| F14' | The report-side `status != "ok"` half of the scope restriction was untested | confirmed | **Fixed**: a failed row carrying a scope is tested (absent from the sent map, named as never-queried) |
| F15' | The capture docstring described the pre-loop write the diff removed | confirmed | **Fixed**: the sentence states the stamp lands with the first written case |
| F16' | The removal of the pre-loop stamp write was pinned by no test | confirmed | **Fixed**: the seam observes that the rows file does not exist while the first case is queried |
| F17' | The story's F9' row claimed the resume refusal was documented — it was not | confirmed | **Fixed**: the Implementation Notes paragraph names the refusal |
| F18' | The story's ruff sentence was not reproducible as written | confirmed | **Fixed**: the working invocation is quoted, the cwd sensitivity is stated |
| F19' | The story's eval count caveat understated the loss without openpyxl | confirmed | **Fixed**: both numbers are stated |
| F20' | The measurement allowlist kept three token-count names while the docstring promised "the token counts" | confirmed (latent) | **Fixed**: `input_tokens` / `output_tokens` are whitelisted too |

**Authorized extra fix-review round (cap exception, orchestrator-ruled) on
`9b06a7ff8..0109ff9fd` — 9 findings, every claim confirmed, all fixed.** The
round was authorized because the f=2 corrections had never been re-reviewed.

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| F21' | The `input_tokens` / `output_tokens` allowlist entries had no test | confirmed | **Fixed**: a test asserts an M-5 usage record keeps them |
| F22' | The measurement allowlist was unpinned — six of its entries could be deleted with the suite green | confirmed | **Fixed**: a table-driven test asserts every declared name survives the redaction |
| F23' | The redaction ran BEFORE the comparison, so `identical` was computed on the redacted maps (a credential-named difference read as "identical") | confirmed | **Fixed**: the comparison runs on the raw maps; only the emitted copies are redacted |
| F24' | `cases_that_never_queried` named an `http_error` row that DID issue a request | confirmed | **Fixed**: only a skipped row is never-queried; the others are scope-less, and the capture records the scope it SENT (an http_error row sent one) |
| F25' | The redacted-path enumeration named two paths of six | confirmed | **Fixed**: the docstring and the rule's comment list all six |
| F26' | The M-5 redaction truncated the usage detail sub-dicts (`*_tokens_details`) | confirmed (latent) | **Fixed**: a token-COUNT suffix rule keeps the counts (and the names inside the detail sub-dicts) while the credential qualifiers stay excluded |
| F27' | The story presented the eval count as a measured fact (the suite is order-flaky) | confirmed | **Fixed**: both counts and the flake are stated |
| F28' | The story claimed `py_compile` stands in CI — no compile job exists over this tree | confirmed | **Fixed**: the sentence states what CI actually runs |
| F29' | The cwd-sensitivity sentence implied this story's own test file was clean under both invocations | confirmed | **Fixed**: the file is named in the root-dirty set |

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
