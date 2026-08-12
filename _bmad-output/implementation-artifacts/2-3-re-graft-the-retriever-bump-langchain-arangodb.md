---
title: 'Re-graft the retriever + bump langchain-arangodb'
type: 'feature'
created: '2026-08-12'
status: 'done'
baseline_commit: 'fb1f53243358953c84116b918849d1938fca09db'
review_loop_iteration: 1
followup_review_recommended: true
context: []
warnings: [oversized]
deferred:
  - summary: >-
      contracts/README.md retriever-suite command still lists test_contract_telemetry.py while the CI CONTRACT_TEST_PATTERN runs no telemetry tests (moved to contract:unit) — pre-existing drift, surfaced while syncing README.
    evidence: |-
      README "Full retriever-capable suite" (contracts/README.md) includes test_contract_telemetry.py; .gitlab-ci.yml contract:retriever-arango pattern does not, with a comment stating telemetry moved to contract:unit. Both pre-date story 2.3; not caused by it.
    location: genie-ai-overlay/contracts/README.md
    severity: low
  - summary: >-
      No in-image behavioral fusion test drives invoke through the hybrid path with a stubbed BM25/vector channel; the contract covers rrf_fuse purely + a source-introspection guard, and the mocked suite covers invoke behavior.
    evidence: |-
      contracts/_harness.py fakes HTTP only — no ArangoDB mock, so invoke's vector/BM25 channels cannot run in-image. Mocked tests/test_retriever.py TestHybridInvoke.test_on_fuses_bm25_doc_into_results (with deps mocked) covers the fused-output behavior. A behavioral in-image fusion test needs ArangoDB-mock infrastructure the harness lacks.
    location: genie-ai-overlay/contracts
    severity: low
  - summary: >-
      No test asserts invoke returns rrf_fuse(...)[:input.k]; a regression dropping the post-fusion top-k slice passes the suite.
    evidence: |-
      invoke fuses then slices (genieai_retriever_arangodb.py:1025-1041, [: int(input.k)]). Mocked tests assert fused membership/order but not the slice; a source-guard for the slice would be brittle. Behavior change would surface only via retrieval-quality regressions.
    location: genie-ai-overlay/retriever/genieai_retriever_arangodb.py:1025
    severity: low
---

<intent-contract>

## Intent

**Problem:** The retriever module must be proven re-grafted to OPEA v1.5: `langchain-arangodb` at the version compatible with v1.5's `langchain-core` (0.3.x), the `ArangoVector` path and `OpeaComponent` adapter validated against the v1.5 `comps` surface, and the in-image contract test green — label-filter (`filter_clause`) and RRF fusion behavior covered — so retrieval does not silently change across the v1.3→v1.5 bump.

**Approach:** Confirm the already-adopted `langchain-arangodb==0.0.6` (v1.5's own lock pin) is the correct "bump": it is API-compatible with the v1.3-era `>=1.2.0` code and carries the `filter_clause` named-param fix (0.0.4's silent-drop bug is gone). Verify the adapter imports and runs against v1.5 `comps` + the compiled lock (the in-image contract run is the gate), close the missing RRF-fusion contract coverage, correct the stale Dockerfile `filter_clause` comment, and record the langchain-arangodb disposition.

## Boundaries & Constraints

**Always:**
- Keep `langchain-arangodb==0.0.6` (v1.5's lock pin). Do NOT bump to 1.2.0+: it requires `langchain-core` >= 0.4 (out of v1.5's `<0.4` range), which would drag the tree beyond v1.5 fidelity and violate the behavior-preserving intent. Verified API-compatible for every param the adapter uses (constructor + search signatures identical to the `>=1.2.0` era; 1.2.0 adds only a trailing `metadata_clause` the adapter does not use).
- Preserve the overlay adapter's label-filter data contract: chatqna encodes labels in `search_start` (`core/label_contract.py`), the retriever decodes at the top of `invoke` (`genieai_retriever_arangodb.py:765-774`) and builds the AQL `FILTER` via `_build_aql_filter_clause`. Do not change this boundary — chatqna is still v1.3 until story 2.6.
- Keep intact: the adapter's `filter_clause=` call sites, the `_chunk_passes_label_filter` defense-in-depth re-filter, and the RRF fusion machinery (`rrf_fuse`, `_ensure_bm25_view`, `_bm25_search`). Contract tests assert them.
- The in-image contract suite (`contract:retriever-arango`) is the gate: `test_contract_label_filter.py` + the e2e label roundtrip must pass against the built image. Add RRF-fusion contract coverage (currently missing).
- Preserve the mocked suite (`tests/test_retriever.py`, `test_build_filter_labels.py`, `test_label_contract.py`).

**Block If:** None — every decision is determined by verified upstream evidence.

**Never:**
- Do NOT change the `langchain-arangodb` version in `requirements.in`/lock.
- Do NOT modify chatqna (the encoder stays v1.3 until 2.6).
- Do NOT re-baseline `tests/conftest.py` comps stubs (story 2.8 owns mock-reality parity).
- Do NOT remove the `_chunk_passes_label_filter` / `_build_aql_filter_clause` / RRF helpers.
- Do NOT touch `sprint-status.yaml` (orchestrator-owned).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | labels in search_start (`chunk::labels:A,B`) + dense+bm25 channels | decode labels, build AQL FILTER, fuse dense+bm25 via weighted RRF | no error expected |
| NO_LABELS | plain search_start (`chunk`) | decode no-op, empty FILTER clause, fused results | no error expected |
| FILTER_DROP | lib ignores `filter_clause` | wrong-category chunk in dense results | `_chunk_passes_label_filter` re-filter excludes it |
| UNKEYED_DOC | bm25 result with no normalizable `_key` | RRF keeps it standalone (never dropped/mis-merged) | synthetic id |

</intent-contract>

## Code Map

- `genie-ai-overlay/retriever/genieai_retriever_arangodb.py` -- overlay adapter (wholesale replacement of v1.5 `comps/retrievers/src/integrations/arangodb.py`). Imports `from langchain_arangodb import ArangoVector` (:15), `from langchain_community.embeddings import HuggingFaceBgeEmbeddings` (:16), `from langchain_huggingface import HuggingFaceEndpointEmbeddings` (:18), `from langchain_openai import ChatOpenAI, OpenAIEmbeddings` (:19), `from comps import CustomLogger, EmbedDoc, OpeaComponent, OpeaComponentRegistry, ServiceType` (:12), protocol types from `comps.cores.proto.genieai_api_protocol` (:13). Registers `GENIE_RETRIEVER_ARANGODB` (:180-181). `ArangoVector` built with v1.5 kwargs (:920-930); search calls pass `filter_clause=` (:952,968,978,990); label decode at top of `invoke` (:765-774); `_build_aql_filter_clause` (:103-119); `_chunk_passes_label_filter` (:87); `rrf_fuse` (:137-177), `_ensure_bm25_view` (:296-335), `_bm25_search` (:337-393); fusion call (:1025-1041). Already v1.5/0.0.6-compatible — verification target; likely no code change (fix only if verification surfaces a break).
- `genie-ai-overlay/retriever/genieai_retriever_microservice.py` -- overlay microservice (`@register_microservice`, `OpeaComponentLoader`, `@register_statistics`); v1.5 surfaces unchanged. Verify only.
- `genie-ai-overlay/retriever/config.py` -- overlay config module; shadows v1.5 upstream config.py via Dockerfile COPY. Defines ARANGO_*, HYBRID_*, traversal, TEI/VLLM/OpenAI names. Verify the adapter's `from .config import (...)` names all resolve.
- `genie-ai-overlay/retriever/Dockerfile-retriever_genie-ai` -- clones OPEA v1.5, copies overlay files over vendored comps. COMMENT LINES 40-43 ARE STALE: claim the ">=1.2.0 filter_clause fix-pin is NOT present in the v1.5 lock and is restored by story 2.3's bump" — false; 0.0.6 has the named `filter_clause` param. Fix the comment.
- `genie-ai-overlay/retriever/requirements.in` -- `langchain-arangodb==0.0.6` (:28, v1.5 pin). Add disposition comment (fix present; no bump beyond).
- `genie-ai-overlay/core/label_contract.py` -- `encode_filter_labels` (:29) / `decode_filter_labels` (:48); the search_start label contract. Do not change.
- `genie-ai-overlay/core/genieai_api_protocol.py` -- overlay fork (`from api_protocol import *` + subclasses); OVERRIDES.yaml entries marked `re-graft-to-new-API` (2.1). Verify it imports against v1.5 api_protocol (all needed names verified exported).
- `genie-ai-overlay/contracts/test_contract_label_filter.py` -- in-image label-filter contract (AQL clause construction + `_chunk_passes_label_filter` + source-introspection of `filter_clause=` call sites). Model for the new RRF contract test.
- `genie-ai-overlay/contracts/test_contract_e2e_pipeline.py` -- label-contract roundtrip + orchestrator wire. No RRF coverage.
- `genie-ai-overlay/contracts/_harness.py` + `conftest.py` -- in-image comps guard (`in_image_comps_importable`), fake HTTP, `WIRE_KWARGS`.
- `genie-ai-overlay/tests/test_retriever.py` -- mocked RRF tests (`rrf_fuse` :663-713) to mirror in the contract suite.
- `.gitlab-ci.yml` -- `contract:retriever-arango` (:772) `CONTRACT_TEST_PATTERN` (:783) — add the new RRF fusion contract test.
- `genie-ai-overlay/OVERRIDES.yaml` + `build-patches/lint_overrides.py` -- override audit; run `lint_overrides.py` (exit 0) after any overlay change.

## Tasks & Acceptance

**Execution:**
- `genie-ai-overlay/retriever/Dockerfile-retriever_genie-ai` -- correct the stale langchain-arangodb comment (:40-43): 0.0.6 DOES carry the `filter_clause` named-param fix (0.0.4 was the silent-drop bug); the label-filter is real at 0.0.6. -- removes a false claim a reader would act on.
- `genie-ai-overlay/retriever/requirements.in` -- add a comment above `langchain-arangodb==0.0.6` documenting the disposition: v1.5's own lock pin; `filter_clause` named-param fix present at 0.0.6 (0.0.4 swallowed it via `**kwargs`); no bump beyond — the reason is compiled-lock fidelity with v1.5's shipped set, NOT a `langchain-core` incompatibility (every release supports `langchain-core>=0.3.8`; do NOT write a `>=0.4` claim — it is false). -- closes 2-2 deferred DW-1; records the "bump" decision.
- `genie-ai-overlay/retriever/Dockerfile-retriever_genie-ai` -- correct the stale langchain-arangodb comment (:40-43): 0.0.6 DOES carry the `filter_clause` named-param fix (0.0.4 was the silent-drop bug); the label-filter is real at 0.0.6. Do NOT add any `langchain-core` version claim (the compat rationale is false). -- removes a false claim a reader would act on.
- `genie-ai-overlay/contracts/test_contract_retriever_fusion.py` -- NEW: pure `rrf_fuse` contract tests mirroring the mocked `TestRrfFuse` class in `tests/test_retriever.py` (reference the class by name, not by line range — line numbers drift). Coverage: within-channel dedup keeps best rank; single-channel; dual-channel weighted fusion ordering (pass EXPLICIT `dense_weight=1.0, lexical_weight=1.0` — do not rely on env-default weights, which a deployment may change); empty input -> []; weight asymmetry; no-input-mutation (assert the returned list is NOT the same object as either input — identity, not just element equality); lexical-only doc survives; unkeyed docs kept standalone — assert the actual id set (e.g. `{r["doc"].id for r in fused} == {None, "a"}`), not just a length count. Plus a source-introspection assertion that `invoke` still calls `rrf_fuse(` for the hybrid path AND that `mod.HYBRID_RETRIEVAL_ENABLED is True` (pins the hybrid default so a silent flip to off fails in-image). Model the module-import guard on `test_contract_label_filter._retriever_module()`. Docstring wording: the fusion call lives in the retriever re-graft, not in langchain-arangodb — attribute the risk correctly. -- AC5: RRF fusion covered by the contract test (currently missing).
- `genie-ai-overlay/contracts/test_contract_label_filter.py` -- ADD an in-image test that the REAL installed `langchain_arangodb.ArangoVector` exposes `filter_clause` as a NAMED parameter on the search methods the adapter calls (e.g. `inspect.signature(ArangoVector.similarity_search_with_score)` contains `filter_clause`) — substantiates durably the "0.0.6 carries the fix" claim (0.0.4's signature lacked it) instead of relying on a comment. Guard with the `comps` fixture (skips outside the image). -- makes the story's central claim testable in-image.
- `.gitlab-ci.yml` -- add `test_contract_retriever_fusion.py` to the `contract:retriever-arango` `CONTRACT_TEST_PATTERN`. -- wires the new coverage into the in-image gate.
- `genie-ai-overlay/retriever/genieai_retriever_arangodb.py` (+ `config.py` / `core/genieai_api_protocol.py` as needed) -- verification-driven re-graft: if the in-image/venv import or contract run surfaces a v1.5 break, fix it here. No change expected; fix only what verification proves broken. -- the re-graft contingency.
- `genie-ai-overlay/OVERRIDES.yaml` -- no new entries expected (adapter is a wholesale overlay, not a tracked override); re-verify the api_protocol fork's 4 `re-graft-to-new-API` markers still describe the v1.5 state. -- override audit stays coherent.

**Acceptance Criteria:**
- Given the v1.5 retriever lock, when the adapter's real imports are exercised against `langchain-arangodb==0.0.6` + v1.5 comps (in-image contract run, or targeted venv), then `import comps.retrievers.src.integrations.genieai_retriever_arangodb` imports cleanly and `_chunk_passes_label_filter`, `_build_aql_filter_clause`, `rrf_fuse` behave as the contract tests assert.
- Given the built retriever image, when the `contract:retriever-arango` suite runs (label-filter, e2e roundtrip, orchestrator wire, fusion, NFRP budgets), then all pass — label-filter + RRF fusion behavior is covered and green on v1.5.
- Given the new RRF contract test, when `rrf_fuse` is exercised, then fusion behavior (dedup by normalized `_key`, weighted rank contribution, unkeyed-doc isolation, empty -> []) is asserted in the in-image suite, not only the mocked suite.
- Given the Dockerfile/requirements.in edits, when reviewed, then no stale `>=1.2.0`/fix-pin claim remains and the 0.0.6 disposition is documented.
- Given the mocked suite, when `pytest tests/test_retriever.py tests/test_build_filter_labels.py tests/test_label_contract.py` runs, then all pass (no adapter regression).
- Given the override audit, when `python build-patches/lint_overrides.py` runs, then exit 0.

## Spec Change Log

### 2026-08-12 — bad_spec loopback (review pass 1)
Triggering finding: the spec's "Why not bump to 1.2.0+" rationale (also repeated in the intent-contract Boundaries) claimed 1.2.0+ requires `langchain-core` >= 0.4. Verified FALSE against PyPI metadata: every `langchain-arangodb` release (0.0.6, 1.2.0, 2.0.0, latest 2.1.0) requires `langchain-core>=0.3.8` with an upper bound `<0.4.0` or wider — none requires `>=0.4`. Amended (outside the read-only intent-contract): Design Notes rationale corrected to the real reasons (v1.5 compiled-lock fidelity + `filter_clause` fix present at 0.0.6 + no identified bug); the `requirements.in` and Dockerfile task wording now forbid writing a `langchain-core >= 0.4` claim. Also folded review-pass patch findings into the fusion contract-test task (unkeyed-doc id-set assertion, mutation identity, explicit weights in the ordering test, docstring class-name reference + correct risk attribution, `HYBRID_RETRIEVAL_ENABLED is True` default pin) and added an in-image test that the real `ArangoVector` exposes `filter_clause` as a named param. Known-bad state avoided: a future developer bumping on a false compat belief, or deleting the label-filter guard on a false premise; an unsubstantiated central claim ("0.0.6 has the fix") left comment-only. KEEP: the `langchain-arangodb==0.0.6` pin unchanged; the stale Dockerfile-comment correction; the fusion contract test file + CI wiring + README sync pattern; the mocked-suite + targeted real-0.0.6 import-check + in-image-contract-gate verification approach.

## Review Triage Log

### 2026-08-12 — Review pass
- intent_gap: 0
- bad_spec: 1: (medium 1)
- patch: 6: (medium 1, low 5) — folded into the spec amendment; re-derived, not individually patched
- defer: 3: (low 3)
- reject: 7: (low 7)
- addressed_findings:
  - `[medium]` `[bad_spec]` false `langchain-core >= 0.4` rationale for keeping 0.0.6 (verified: all releases support >=0.3.8) — Design Notes + task wording corrected; comments will be re-derived without the claim.
  - `[medium]` `[patch→spec]` "0.0.6 carries the filter_clause fix" was comment-only, unsubstantiated by any test — added an in-image `ArangoVector` named-param signature test to `test_contract_label_filter.py`.
  - `[low]` `[patch→spec]` unkeyed-doc fusion test asserted only a length count, not the standalone/synthetic-id behavior — task now requires asserting the id set.
  - `[low]` `[patch→spec]` no-input-mutation test checked element equality, not identity — task now requires `fused is not` either input.
  - `[low]` `[patch→spec]` dual-channel ordering test relied on env-default weights — task now requires explicit weights.
  - `[low]` `[patch→spec]` docstring cited a stale line range and mis-attributed the fusion call to the lib bump — task now references the class by name and attributes risk to the retriever re-graft.
  - `[low]` `[patch→spec]` flipping the `HYBRID_RETRIEVAL_ENABLED` default to off would silently disable fusion with no test failure — fusion source-guard task now also pins `mod.HYBRID_RETRIEVAL_ENABLED is True`.
- Rejected (noise / by-design / pre-existing): "no dependency bump" (intent-contract explicitly forbids a bump); pure-test duplication of the mocked suite (contracts/ deliberately mirrors the mocked pure tests — sibling-suite design); `inspect.getsource` fragility (established label-filter convention; mocked `TestHybridInvoke` covers the behavior); fusion pure tests gated behind the `comps` fixture (cannot run locally without real/mocked comps; in-image is the gate); `_retriever_module` fail-red-vs-skip semantics (matches the label-filter contract convention); source-introspection guard redundancy (behavior is mocked-covered; the guard is a redundant tripwire); disposition recorded in code comments (a valid record).

### 2026-08-12 — Review pass (re-derivation)
- intent_gap: 0
- bad_spec: 0
- patch: 3: (medium 1, low 2)
- defer: 0: (0 new; pass-1 items re-confirmed)
- reject: 8: (low 8)
- addressed_findings:
  - `[medium]` `[patch]` `test_installed_arangovector_exposes_filter_clause_named_param` covered only `similarity_search_with_score`/`similarity_search`, but the retriever's MMR branch (`amax_marginal_relevance_search`) funnels through langchain-core's `max_marginal_relevance_search` → `similarity_search_by_vector` — extended the loop to the full sync family (`similarity_search`, `similarity_search_with_score`, `similarity_search_by_vector`, `similarity_search_by_vector_with_score`), pinned `importlib.metadata.version("langchain-arangodb") == "0.0.6"`, and guarded `inspect.signature` with try/except → pytest.fail.
  - `[low]` `[patch]` `requirements.in` disposition comment said "IS the intended bump target" while the Dockerfile said "needs no version bump" — aligned the framing and scoped the `langchain-core` claim to the installed 0.0.6 (`>=0.3.8,<0.4`) instead of asserting about all releases.
  - `[low]` `[patch]` no fusion test asserted doc/metadata identity survives `rrf_fuse` — added `test_fused_doc_keeps_input_identity` (same doc object + `chunk_embedding` metadata preserved through fusion).
- Rejected (noise / by-design / pre-existing): "no dependency bump" (intent-contract forbids); the built image not provably installing 0.0.6 (lock pins it at requirements-cpu.txt:1913); dedup "best rank" not distinguishable (keep-first vs keep-best are identical for the same id; the test asserts the first-occurrence 1/61); narrative duplicated across 4 comment sites (each context-appropriate); `comps` fixture decorative on pure tests (matches the label-filter convention); function-local vs module-top imports (matches the label-filter file's own convention); `_FakeDoc(id=None)` AttributeError assumption (verified: the shim contract run passes `test_unkeyed_doc_kept_standalone` against real `rrf_fuse`); `HYBRID_RETRIEVAL_ENABLED is True` identity on an env-derived flag (CI image has no deployment env, so the default true holds; the pin is the point); config-defaults not pinned (deliberate — tests pass explicit weights); source-guard fragility (deferred D2; mocked `TestHybridInvoke` covers the behavior); intent divergence #3 — the intent-contract's "1.2.0+ requires langchain-core >=0.4" is verified false and the diff correctly omits it.

## Design Notes

- **The "bump" is already in the v1.5 lock.** 2-2 adopted `langchain-arangodb==0.0.6` (v1.5's own pin) with `langchain-core==0.3.86`. Verified: 0.0.6 requires `langchain-core>=0.3.8,<0.4.0` (0.3.86 in-range); the `ArangoVector` constructor and every search signature the adapter uses are identical to the 1.2.0 era (1.2.0 adds only a trailing `metadata_clause`). The adapter (written against `>=1.2.0` on v1.3) therefore needs no vector-path code change. The `filter_clause` fix the old `>=1.2.0` pin provided is present at 0.0.6 — 0.0.4 silently swallowed it via `**kwargs`; 0.0.6 promotes it to a named param on every search method and injects it into the AQL. The 2-2 deferred item ("fix-pin gone until story 2.3 bumps it") is resolved by verification, not a version bump.
- **Why not bump beyond 0.0.6.** Verified against PyPI metadata: EVERY `langchain-arangodb` release (0.0.6, 1.2.0, 2.0.0, latest 2.1.0) requires `langchain-core>=0.3.8` with an upper bound `<0.4.0` or wider — none requires `>=0.4`. So the "1.2.0+ needs `langchain-core` >= 0.4" claim the intent-contract Boundaries states is FACTUALLY INCORRECT (verified); it must NOT appear in any code comment. The real reason to stay at 0.0.6: (1) it is v1.5's own compiled-lock pin, and the fork keeps compiled-lock fidelity with v1.5 (the epic's behavior-preserving + lock-fidelity principle); (2) the `filter_clause` fix is present at 0.0.6; (3) no identified bug a bump would fix. Bumping to 1.2.0+ would recompile the lock away from v1.5's shipped set for no functional gain. The constraint is correct; only the intent-contract's stated justification is wrong (read-only; not amended).
- **The in-image contract is the only real import gate.** `tests/conftest.py` stubs `comps`, `langchain_arangodb`, `langchain_community`, `arango` in `sys.modules` (:30-99) and the overlay `pyproject.toml` ships no base `dependencies` (test extras only) — so the mocked suite cannot detect a real-lock import break. Only `contract:retriever-arango` (builds the image, runs the contract suite against real vendored comps + the installed 0.0.6) exercises the true surface. If docker is unavailable locally, the CI pipeline is the gate.
- **RRF contract gap.** `tests/test_retriever.py` covers `rrf_fuse` thoroughly; `contracts/` has none. The new `test_contract_retriever_fusion.py` mirrors the pure tests (same pattern as the label-filter pure tests) so AC5 is satisfied in-image.

## Verification

**Commands:**
- `cd genie-ai-overlay && python build-patches/lint_overrides.py` -- expected: exit 0 (override manifest sync).
- `cd genie-ai-overlay && source .venv/bin/activate && python -m pytest tests/test_retriever.py tests/test_build_filter_labels.py tests/test_label_contract.py -q` -- expected: green (mocked suite; conftest stubs comps+langchain).
- `cd genie-ai-overlay && ruff check contracts/ && ruff format --check contracts/` -- expected: clean (new contract test).
- Targeted venv import (if no docker): install `langchain-arangodb==0.0.6 langchain-core==0.3.86 langchain-community==0.3.31 langchain-huggingface==0.3.1 langchain-openai==0.3.35 fastapi pydantic docarray opentelemetry-api` + stub `comps` (reuse `tests/conftest.py`'s sys.modules mock), then `python -c "import comps.retrievers.src.integrations.genieai_retriever_arangodb"` -- expected: imports clean; `ArangoVector` resolves from `langchain_arangodb`, `HuggingFaceBgeEmbeddings` from `langchain_community.embeddings`, `HuggingFaceEndpointEmbeddings` from `langchain_huggingface`.
- In-image contract (docker available): `docker build -f genie-ai-overlay/retriever/Dockerfile-retriever_genie-ai -t genie-ai-retriever-arango:latest .` then the CI `contract:retriever-arango` invocation (contracts/README.md pattern) -- expected: all contract tests pass; this is THE gate for AC2.

**Manual checks (if no CLI):**
- Dockerfile comment: no stale `>=1.2.0`/fix-pin claim remains.
- `requirements.in`: `langchain-arangodb==0.0.6` carries the disposition comment.
- `.gitlab-ci.yml`: `contract:retriever-arango` pattern includes the new fusion test.

## Auto Run Result

Status: done

**Summary:** Story 2.3 re-grafted the retriever onto OPEA v1.5 and validated the `langchain-arangodb` bump by evidence, not a version change: the already-adopted `0.0.6` pin (v1.5's own compiled-lock version) was verified API-compatible with the v1.3-era `>=1.2.0` code and carrying the `filter_clause` named-param fix (0.0.4's `**kwargs` silent-drop is gone). Investigation proved every langchain-arangodb release (0.0.6 → 2.1.0) requires `langchain-core>=0.3.8` — none `>=0.4` — so the "bump" is lock-fidelity, not a version move. Deliverables: stale Dockerfile comment corrected, `requirements.in` disposition recorded, in-image RRF-fusion contract coverage added and wired into the `contract:retriever-arango` CI gate, an in-image test that the installed `ArangoVector` exposes `filter_clause` as a named param across the full sync search family (incl. the MMR `by_vector` funnel) pinned at version 0.0.6, and the adapter verified to import cleanly against the real lock. One bad_spec loopback (the spec's false "1.2.0+ needs langchain-core >=0.4" rationale) + one patch pass closed the review findings.

**Files changed:**
- `genie-ai-overlay/retriever/Dockerfile-retriever_genie-ai` — corrected stale comment: 0.0.6 carries the `filter_clause` named-param fix; no `>=1.2.0` bump needed.
- `genie-ai-overlay/retriever/requirements.in` — disposition comment above `langchain-arangodb==0.0.6`: v1.5 lock pin, fix present, reason is lock fidelity not `langchain-core` incompatibility (verified: `>=0.3.8,<0.4`).
- `genie-ai-overlay/contracts/test_contract_retriever_fusion.py` — NEW: 12 in-image `rrf_fuse` contract tests (weighted fusion, dedup, unkeyed-doc isolation with id-set assert, mutation identity, doc/metadata identity survival, hybrid-source guard + `HYBRID_RETRIEVAL_ENABLED is True` pin).
- `genie-ai-overlay/contracts/test_contract_label_filter.py` — added `test_installed_arangovector_exposes_filter_clause_named_param`: named `filter_clause` on `similarity_search`/`similarity_search_with_score`/`similarity_search_by_vector`/`similarity_search_by_vector_with_score` + `importlib.metadata.version == "0.0.6"` pin.
- `.gitlab-ci.yml` — added `test_contract_retriever_fusion.py` to the `contract:retriever-arango` `CONTRACT_TEST_PATTERN`.
- `genie-ai-overlay/contracts/README.md` — suite-layout + invocation synced for the fusion test.
- `_bmad-output/implementation-artifacts/2-3-re-graft-the-retriever-bump-langchain-arangodb.md` — this spec.

**Review findings breakdown:** Pass 1: 1 bad_spec (false `langchain-core>=0.4` rationale), 6 patch (folded into the spec amendment + re-derivation), 3 defer, 7 reject. Pass 2 (re-derivation): 3 patch applied (1 medium — filter_clause by_vector family + version pin; 2 low — requirements.in wording, doc-identity survival), 0 defer new, 8 reject. No code change to the adapter itself — the re-graft is verification + coverage + comments.

**Follow-up review recommendation:** true — 3 patched findings this pass (1 medium ×3 + 2 low ×1 = score 5 ≥ 5).

**Verification performed:**
- `uv run ruff check contracts/ retriever/` + `ruff format --check` — clean.
- `python3 build-patches/lint_overrides.py` — exit 0 (7 override entries matched).
- Mocked suite `pytest tests/test_retriever.py tests/test_build_filter_labels.py tests/test_label_contract.py` — 119 passed (full `tests/` run: 684 passed per implementation pass).
- Shim in-image contract run (real vendored-comps-shaped tree + real `langchain-arangodb` 0.0.6 in a py3.11 venv): `pytest contracts/test_contract_retriever_fusion.py contracts/test_contract_label_filter.py` — 21 passed, 0 failed, 0 skipped (includes the filter_clause family + version pin and the fusion identity test).
- `git diff --check` + `.gitlab-ci.yml` YAML parse — clean.
- Verified against PyPI: `langchain-arangodb` 0.0.6/1.2.0/2.0.0/2.1.0 all require `langchain-core>=0.3.8` (upper bound <0.4 or wider); none `>=0.4`.

**Residual risks:**
- The real in-image contract run (`contract:retriever-arango` CI job) is the final gate — no Docker locally; the shim run + the existing `test_contract_label_filter.py`/`test_contract_orchestrator_wire.py` in-image precedent make a red run unlikely but not provable here.
- Behavioral in-image fusion through `invoke` (real ArangoDB) is not covered — deferred D2 (needs ArangoDB mock infra; mocked `TestHybridInvoke` covers the behavior).
- `contracts/README.md` telemetry-line drift vs CI pattern — deferred D1 (pre-existing).
- Post-fusion top-k slice `[:input.k]` unguarded — deferred D3.
- The intent-contract's "1.2.0+ requires langchain-core >=0.4" remains factually wrong inside the read-only intent-contract; the spec Design Notes and the code comments carry the corrected rationale.
