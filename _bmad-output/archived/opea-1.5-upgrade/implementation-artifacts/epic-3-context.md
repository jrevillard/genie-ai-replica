# Epic 3 Context: Verification & parity proof

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Prove the OPEA 1.5 upgrade is behavior-neutral and secure: run the RAG-parity evaluation against the locked v1.3 baseline (same corpus/queries/labels/model, seeded, vector-space compat against existing stored embeddings + graph data), evidence the CVE posture as a baseline-diff with no net-new high/critical, confirm the full test suites green against real v1.5 shapes (conftest re-baselined, per-module contract tests in-image), and verify the targeted upstream improvements from the v1.4/v1.5 changelogs are present in the deployed images. The evidence ledger is committed with the change-set so the upgrade is provable after the fact, and the `verify:evidence` CI gate passes with `allow_failure: false`.

## Stories

- Story 3.1: Run the RAG-parity evaluation vs the locked baseline
- Story 3.2: Produce the CVE baseline-diff evidence
- Story 3.3: Confirm the full test suites green
- Story 3.4: Confirm the targeted upstream improvements land
- Story 3.5: Complete the evidence ledger + verify:evidence gate

## Requirements & Constraints

- **RAG parity is a gate, not a formality.** Metrics from the parity run (same corpus, queries, labels, model, `temperature=0`, fixed seed) must fall within the baseline variance band captured in `_bmad-output/implementation-artifacts/rag-baseline-v1.3.json`. Any regression — in retrieval quality, label-filter correctness, RAG confidence distribution, or abstention behavior — blocks the upgrade; it is fixed or the upgrade is held.
- **Vector-space compat with the live corpus.** Parity is validated against existing stored embeddings + graph data (not re-ingested docs). The `langchain-arangodb` bump from Epic 2 can silently degrade deployed retrieval if the vector payload or search semantics changed; this is the binding constraint.
- **Regression set covers behavior, not just metrics.** The parity run exercises the label-filter correctness, RAG confidence, and abstention regression set — not just generic parity scores. These are the surfaces where a silent upgrade regression is most damaging.
- **CVE baseline-diff, not a standalone scan.** The v1.5 CVE posture is evidenced as a diff against the pre-upgrade v1.3 advisory (same scanner, same taxonomy, accept-list for known-benign entries). A net-new high/critical CVE blocks the upgrade (hold, or accept-with-documented-risk decided explicitly, not by agent choice).
- **Full suites green against reality.** The full pytest (OPEA) + Jest (backend, frontend, document-repository) suites run on the upgraded overlay with the conftest re-baselined to real v1.5 signatures (Epic 2 story 2.8). Green CI against a stale mock is not acceptance — mock-reality parity is enforced.
- **Per-module contract tests in-image.** Each module's contract test runs against real `comps` inside the built image (Epic 2 story 2.3–2.6), exercising the compiled lock, Python 3.11 `sitecustomize` path, and docarray shim. These are required artifacts for the `verify:evidence` gate.
- **Upstream improvements evidenced, not asserted.** The targeted fixes from the v1.4/v1.5 changelogs (FR-19 enumeration) are confirmed present in the deployed images. Any absent fix is explicitly recorded (not exercised vs not applied).
- **Evidence ledger committed with the change-set.** Override dispositions + rationale, CVE baseline-diff, parity report, red-run logs, contract matrix — all committed as a coherent audit trail. The ledger is the proof the upgrade is provable after the fact.
- **`verify:evidence` CI gate is blocking.** The stage runs `allow_failure: false` and fails if any artifact — override manifest, parity report, red-run log, contract matrix, coherence check — is missing, stale, or empty. The mutation probe (deliberate contract break → pipeline goes red) is re-run to confirm the gates are not theater.
- **No new secrets, no behavior delta beyond documented.** The verification run uses the same configuration as the locked baseline (config-parity); no environment variable, API, or schema change is introduced by the verification itself.

## Technical Decisions

- **Parity run reuses the locked harness.** The same `tests/rag-benchmarks/` harness (SHA recorded in the baseline artifact) runs against the v1.5 stack; no new evaluation tooling is introduced. The run-triple artifact (min/median/max per metric) is compared against the v1.3 run-triple with the variance-derived tolerance.
- **Parity runs against existing stored data.** Vector-space compat is tested against the embeddings + graph data already in ArangoDB from prior v1.3 ingests, not a fresh re-ingest. This is the live-corpus contract — if retrieval degrades on the data actually deployed, the upgrade is held regardless of synthetic-benchmark scores.
- **Regression set is its own gate.** Label-filter correctness (the `langchain-arangodb` 0.0.4 defect surface), RAG confidence distribution (mean-of-reranker-scores weakness), and abstention behavior are exercised independently of the generic parity score; a pass on generic parity with a regression on the set still blocks.
- **CVE diff uses the same scanner/taxonomy as the v1.3 advisory.** The diff is apples-to-apples; an accept-list documents known-benign entries (e.g., test-only dependencies) so the delta is the real posture change.
- **Full-suite green = pytest + Jest + flutter_test.** OPEA pytest (re-baselined conftest), backend/frontend/document-repository Jest, and mobile flutter_test all pass in CI. The `verify:evidence` stage confirms the required artifacts are present and fresh.
- **Mutation probe is re-run in Epic 3.** The deliberate contract break (story 2.7) is re-executed to confirm the pipeline still goes red after the full re-graft; a probe that no longer catches a break means the gates decayed.
- **Evidence ledger is a single committed directory.** All verification artifacts from Epics 1–3 are collected in `_bmad-output/implementation-artifacts/` and referenced by the ledger; the ledger is the index the `verify:evidence` stage checks.
- **Upstream improvements enumeration is execution-time.** FR-19's specific fixes from v1.4/v1.5 changelogs are enumerated during the story (not pre-committed); each fix is confirmed present in the deployed image by grep/version check/changelog cross-reference.

## Cross-Story Dependencies

- Story 3.1 (RAG parity) depends on Epic 1's locked baseline artifact (`rag-baseline-v1.3.json`) and on Epic 2's completed overlay rebase (the v1.5 stack must be built and deployed in the test environment).
- Story 3.2 (CVE baseline-diff) depends on Epic 1's v1.3 CVE advisory capture and Epic 2's v1.5 images being available for scanning.
- Story 3.3 (full suites green) depends on Epic 2's conftest re-baseline (story 2.8) and per-module contract tests (stories 2.3–2.6); the `verify:evidence` stage scaffold from story 2.7 is the gate that this story's artifacts feed.
- Story 3.4 (upstream improvements) depends on Epic 2's deployed v1.5 images; it is independent of 3.1–3.3 but feeds the evidence ledger (3.5).
- Story 3.5 (evidence ledger + gate) depends on all prior stories (3.1–3.4) producing their artifacts; it is the final epic closure — the ledger is not complete until every verification artifact is committed and the mutation probe is re-run.
- Epic 4 (operational readiness) depends on Epic 3's gate passing; canary, rollback rehearsal, and docs update proceed only after parity, CVE, suites, and upstream improvements are evidenced.
