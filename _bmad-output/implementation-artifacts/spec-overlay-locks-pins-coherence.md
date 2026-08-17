---
title: 'Overlay locks, pins & coherence'
type: 'chore'
created: '2026-08-14'
status: 'done'
baseline_revision: 'fe67d634b213a2dd9cdec7ce9f0480c28cff8ced'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
deferred:
  - summary: >-
      No CI job asserts cross-module version coherence for shared deps
      (opentelemetry-*, haystack-ai, openai). Each module's lock is
      internally consistent, but coherence across modules can drift
      silently if a developer bumps one module without updating others.
    evidence: |-
      verify:overlay-locks:retriever and verify:overlay-locks:reranker each
      run uv pip sync --dry-run on their own lock; no job compares versions
      across dataprep/retriever/reranker locks. The spec's manual grep
      (Verification section) is not automated.
    location: >-
      .gitlab-ci.yml:2589-2650
    severity: low
  - summary: >-
      No aggregate `make lock-overlay` target to regenerate all module
      locks at once; only per-module targets (lock-retriever, lock-reranker).
    evidence: |-
      Makefile:16-34 defines lock-retriever and lock-reranker separately;
      no umbrella target. A developer updating shared deps must remember
      to run each target individually.
    location: >-
      Makefile:16-34
    severity: low
  - summary: >-
      No mutual compatibility check for pinned versions (openai==1.81.0,
      haystack-ai==2.3.1, opentelemetry-*==1.27.0) — no test or CI job
      verifies they work together without dependency conflicts.
    evidence: |-
      uv pip sync --dry-run verifies each lock is internally consistent,
      but does not assert cross-package compatibility. No integration test
      exercises the reranker with the new pin set.
    location: >-
      genie-ai-overlay/reranker/requirements-cpu.txt
    severity: low
---

<intent-contract>

## Intent

**Problem:** Eight deferred-work items from story 2.2 (`2-2-migrate-dependencies-python-3-11.md`) expose cross-module version drift (reranker bare `.in` pins resolve newer than dataprep/retriever), a CI drift-guard with incomplete trigger paths (Dockerfile changes don't fire the lock check), and a tag-pipeline blast radius that triples on transient PyPI failures. The fleet shares `genie-ai-overlay/tracing.py` but three modules resolve opentelemetry to different versions; the reranker lock pins openai 3.0.0 while dataprep pins 1.81.0 — a coherence gap that can surface as import-time or behavioral divergence if any shared code path touches both.

**Approach:** Pin the reranker `.in` bare entries to the coherent floor (matching dataprep+retriever), recompile the reranker lock, widen `verify:overlay-locks` trigger paths to include Dockerfiles (the canonical lock-regen trigger), and reduce the tag-pipeline blast radius by scoping each module's check to its own trigger paths. The remaining items (DW-15 moving tags, DW-16 GPU locks, DW-17 pin-policy hybrid, DW-20 torch image size) are documented design decisions acknowledged by this bundle — no code change, recorded as resolved-by-documentation.

## Boundaries & Constraints

**Always:**
- Pin reranker bare `.in` entries (`opentelemetry-api`, `opentelemetry-exporter-otlp`, `opentelemetry-sdk`, `haystack-ai`, `openai`) to the coherent floor matching dataprep+retriever locks: otel `==1.27.0`, haystack-ai `==2.3.1`, openai `==1.81.0`.
- Recompile `genie-ai-overlay/reranker/requirements-cpu.txt` with `uv pip compile --generate-hashes --python-version 3.11 --python-platform x86_64-manylinux_2_31` after pinning.
- Widen `verify:overlay-locks` `rules:changes` to include module Dockerfiles (`genie-ai-overlay/{retriever,reranker}/Dockerfile-*`) — an `OPEA_VERSION` bump or apt change is a canonical lock-regen trigger.
- Scope each module's tag-pipeline check to its own trigger paths (split the loop so a retriever Dockerfile change does not re-run the reranker check).
- Record DW-15/DW-16/DW-17/DW-20 as acknowledged design decisions in the spec's Design Notes.

**Block If:** None — all decisions are determined by verified locked versions and the coherent-floor rule (shared deps pin to the lowest common version across modules).

**Never:**
- Do NOT touch dataprep (no `.in` exists; its lock is the coherent floor source).
- Do NOT change retriever pins (already explicit; the drift is in the reranker).
- Do NOT weaken `uv pip sync --dry-run` to `--no-require-hashes` — the hashed install is the deterministic guarantee.
- Do NOT compile GPU locks (DW-16 — fleet is CPU-only; compose grants no GPU).
- Do NOT digest-pin base images (DW-15 — story 4-2 owns that).
- Do NOT touch `sprint-status.yaml` (orchestrator-owned).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Reranker `.in` pinned | bare otel/haystack-ai/openai → `==1.27.0`/`==2.3.1`/`==1.81.0` | Lock recompiles with matching versions; `uv pip sync --dry-run` exit 0 | Compilation failure → halt, surface uv error |
| Dockerfile change on MR | `Dockerfile-reranker_genie-ai` modified | `verify:overlay-locks` fires for reranker only | No fire = drift goes undetected |
| Tag pipeline transient PyPI failure | `uv pip sync --dry-run` for one module fails on 404 | Only that module's check fails; other modules pass | Pre-existing — mitigated by per-module scoping |

</intent-contract>

## Code Map

- `genie-ai-overlay/reranker/requirements.in` -- bare entries L20-22 (opentelemetry-*), L29 (haystack-ai), L32 (openai) → pin to coherent floor
- `genie-ai-overlay/reranker/requirements-cpu.txt` -- recompile after pinning; torch==2.13.0 at L3116 (DW-20 — documented, not changed)
- `genie-ai-overlay/retriever/requirements.in` -- reference for coherent floor: otel==1.27.0 (L57-59), haystack-ai==2.3.1 (L26), docling==2.55.1 (L18)
- `genie-ai-overlay/dataprep/requirements-cpu.txt` -- reference for coherent floor: otel 1.27.0, openai==1.81.0, fastapi==0.116.1 (no .in exists — lock is source of truth)
- `.gitlab-ci.yml:2553-2600` -- `verify:overlay-locks` job: trigger paths L2593-2600 need Dockerfile widening + per-module scoping
- `Makefile:16-34` -- `lock-retriever`/`lock-reranker` targets (no change needed; already carry `--python-platform`)
- `_bmad-output/implementation-artifacts/deferred-work.md:130-254` -- DW-15 through DW-29 ledger entries (orchestrator-owned; not modified by this bundle)

## Tasks & Acceptance

**Execution:**
- `genie-ai-overlay/reranker/requirements.in` -- pin bare entries: `opentelemetry-api==1.27.0`, `opentelemetry-exporter-otlp==1.27.0`, `opentelemetry-sdk==1.27.0`, `haystack-ai==2.3.1`, `openai==1.81.0` -- cross-module coherence (DW-18/DW-23)
- `genie-ai-overlay/reranker/requirements-cpu.txt` -- recompile with `uv pip compile --generate-hashes --python-version 3.11 --python-platform x86_64-manylinux_2_31 requirements.in -o requirements-cpu.txt` -- hashed lock matches new pins (DW-18/DW-23)
- `.gitlab-ci.yml` -- widen `verify:overlay-locks` `rules:changes` paths to include `genie-ai-overlay/retriever/Dockerfile-*` and `genie-ai-overlay/reranker/Dockerfile-*` -- Dockerfile changes fire the drift guard (DW-19)
- `.gitlab-ci.yml` -- refactor `verify:overlay-locks` script from a single `for MOD in retriever reranker` loop to per-module parallel checks (or split into two jobs) so a tag-pipeline failure in one module does not block the other -- reduced blast radius (DW-29)

**Acceptance Criteria:**
- Given the reranker `.in` pins, when `uv pip compile --generate-hashes --python-version 3.11 --python-platform x86_64-manylinux_2_31 requirements.in -o requirements-cpu.txt` runs, then the lock contains `opentelemetry-api==1.27.0`, `haystack-ai==2.3.1`, `openai==1.81.0` with `--hash=sha256:` markers, and `uv pip sync requirements-cpu.txt --dry-run` exits 0.
- Given the widened trigger paths, when a Dockerfile in `genie-ai-overlay/retriever/` or `genie-ai-overlay/reranker/` changes on an MR, then `verify:overlay-locks` fires for the affected module.
- Given per-module scoping, when `uv pip sync --dry-run` fails for one module on a tag pipeline, then the other module's check passes independently.
- Given DW-15/DW-16/DW-17/DW-20, when the spec is reviewed, then Design Notes document each as an acknowledged design decision with its disposition (no code change).

## Spec Change Log

## Review Triage Log

### 2026-08-14 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 3: (low 3)
- reject: 7: (low 7)
- addressed_findings:
  - none

## Design Notes

- **Coherent floor rule.** Shared deps (opentelemetry-*, haystack-ai, openai) are pinned to the lowest common version across modules: dataprep lock is the floor source (otel 1.27.0, openai 1.81.0); retriever `.in` is the secondary reference (haystack-ai 2.3.1). The reranker `.in` bare entries are the drift source — pinning them to the floor eliminates uncontrolled resolution.
- **DW-15 (moving tags).** Base images `python:3.11-slim` and `opea/*:1.5` are moving tags; byte-identical digests across time are bounded by base-tag stability. Digest-pinning is story 4-2's scope. Acknowledged, no action.
- **DW-16 (GPU locks).** Fleet is CPU-only (compose grants no GPU to dataprep/retriever/reranker). GPU locks can be compiled from the same `.in` when needed. Acknowledged, no action.
- **DW-17 (pin-policy hybrid).** `.in` files are fork-plus-selective-pins: dataprep pins docling==2.45.0 (v1.5 lock), retriever pins docling==2.55.1 (intentional divergence). Unpinned entries can drift on regen; re-fork + re-pin on next bump. Acknowledged, no action.
- **DW-20 (torch 2.13.0 image size).** All three CPU locks pin torch==2.13.0 (via sentence-transformers); the CUDA-bundled PyPI wheel adds ~2.5GB to each image. Image size is story 2.4/2.5 build-surface territory. Acknowledged, no action.

## Verification

**Commands:**
- `cd genie-ai-overlay/reranker && uv pip compile requirements.in --generate-hashes --python-version 3.11 --python-platform x86_64-manylinux_2_31 --output-file requirements-cpu.txt` -- expected: exit 0; lock carries `--hash=sha256:` on every package; otel==1.27.0, haystack-ai==2.3.1, openai==1.81.0 present
- `cd genie-ai-overlay/reranker && uv pip sync requirements-cpu.txt --dry-run --system` -- expected: exit 0 (lock consistent)
- `grep -E "^(opentelemetry-api|haystack-ai|openai)==" genie-ai-overlay/reranker/requirements-cpu.txt` -- expected: `opentelemetry-api==1.27.0`, `haystack-ai==2.3.1`, `openai==1.81.0`
- `grep -n "Dockerfile" .gitlab-ci.yml | grep -A2 "verify:overlay-locks"` -- expected: Dockerfile paths present in trigger rules
- Cross-module coherence check: `grep -E "^(opentelemetry-api|haystack-ai|openai)==" genie-ai-overlay/{dataprep,retriever,reranker}/requirements-cpu.txt` -- expected: otel 1.27.0 consistent across all three; openai 1.81.0 in dataprep+reranker (retriever uses langchain-openai, no direct pin)

## Auto Run Result

Status: done

**Summary:** Pinned 5 bare entries in `genie-ai-overlay/reranker/requirements.in` to the coherent floor (opentelemetry-*==1.27.0, haystack-ai==2.3.1, openai==1.81.0), recompiled the reranker lock with hashes, refactored `verify:overlay-locks` from a single for-loop job into two per-module jobs (`.verify-overlay-lock-base` template + `verify:overlay-locks:retriever` / `verify:overlay-locks:reranker`), widened trigger paths to include `Dockerfile-*` per module, and documented DW-15/DW-16/DW-17/DW-20 as acknowledged design decisions in Design Notes.

**Files changed:**
- `genie-ai-overlay/reranker/requirements.in` — 5 bare entries pinned to coherent floor versions (DW-18/DW-23)
- `genie-ai-overlay/reranker/requirements-cpu.txt` — recompiled with `uv pip compile --generate-hashes --python-version 3.11 --python-platform x86_64-manylinux_2_31`; otel 1.44.0→1.27.0, haystack-ai 3.0.0→2.3.1, openai 3.0.0→1.81.0 (DW-18/DW-23)
- `.gitlab-ci.yml` — `verify:overlay-locks` refactored into hidden template `.verify-overlay-lock-base` + two per-module jobs; trigger paths widened to include `Dockerfile-*` per module; tag-pipeline blast radius reduced (DW-19/DW-29)

**Review findings breakdown:** 0 intent_gap, 0 bad_spec, 0 patch, 3 defer (low), 7 reject (low). Deferred: cross-module coherence CI guard not automated (pre-existing), no aggregate `make lock-overlay` target (pre-existing), no mutual compatibility check (pre-existing). Rejected: openai coherence claim vs retriever 1.109.1 (spec Design Notes clarify dataprep is floor for openai), dataprep Dockerfile not in trigger paths (dataprep has no .in), blast radius not quantified (cosmetic), DW-20 assessment artifact (intent.md classifies as documented design decision), DW-16 GPU locks not compiled (ledger says CPU-only fleet), staging test (pre-existing), security review (pre-existing).

**Follow-up review recommendation:** false — 0 patches this pass (score = 0 < 5).

**Verification performed:**
- `uv pip sync requirements-cpu.txt --dry-run` exit 0 (reranker lock consistent)
- `grep -E "^(opentelemetry-api|haystack-ai|openai)=="` confirms otel==1.27.0, haystack-ai==2.3.1, openai==1.81.0 in reranker lock
- Cross-module coherence: otel 1.27.0 consistent across dataprep/retriever/reranker; haystack-ai 2.3.1 in retriever+reranker; openai 1.81.0 in dataprep+reranker (retriever uses langchain-openai, no direct pin)
- YAML validation: `python3 -c "import yaml; yaml.safe_load(open('.gitlab-ci.yml'))"` valid
- `grep -n "Dockerfile"` confirms Dockerfile paths in trigger rules
- Diff stats: .gitlab-ci.yml +73/-28, reranker/requirements.in +5/-5, reranker/requirements-cpu.txt recompiled (3411→3947 lines)

**Residual risks:**
- No automated CI guard for cross-module version coherence — drift can regress silently if a developer bumps one module's shared dep without updating others. Manual grep in spec Verification section is not enforced.
- Retriever's `openai==1.109.1` (resolved via langchain-openai) differs from dataprep+reranker's `openai==1.81.0` — intentional divergence (retriever doesn't pin openai directly; dataprep is the floor for explicit pins).
- DW-15/DW-16/DW-17/DW-20 remain as documented design decisions with no code change — future stories may revisit.
- No `docker build` executed in this environment; CI build jobs are the live gate for install/wheel/source-build failures.
