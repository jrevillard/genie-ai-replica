# Red-run evidence — contract suite vs a bare v1.5 bump

**Date:** 2026-08-11
**Story:** 1-5-write-contract-tests-green-on-v1-3-prove-red-on-a-bare-v1-5-bump
**PRD:** opea-1.5-upgrade (FR-10, pre-rebase milestone (d))
**Method:** build the retriever module image with `--build-arg OPEA_VERSION=v1.5`
and NO overlay re-graft (bare bump), then run the contract suite against it.

## Outcome

**RED — the bare v1.5 bump fails on real, committed surfaces.** The failure is
not a suite-collection hiccup; the v1.5 image cannot even complete a build with
the v1.3 overlay as-is, and each successive build accommodation (re-pointing the
stale `REQ_PATH`, bumping Python, adding a system lib) revealed the NEXT real
1.5 break. This is the milestone-(d) proof: the overlay does not silently work
against v1.5 — the gap is structural and the contract/verification layer exists
precisely to catch it before any re-graft.

## Failure chain (each a real 1.5 delta, recorded)

| # | Build surface | v1.3 (green) | Bare v1.5 bump | Evidence |
|---|---------------|--------------|----------------|----------|
| 1 | `REQ_PATH` target | `comps/retrievers/src/requirements.txt` exists | **gone** — replaced by compiled `requirements-cpu.txt`/`requirements-gpu.txt` (FR-9 surface) | build error: "Could not open requirements file: …/requirements.txt" |
| 2 | Python base | `python:3.10-slim` (v1.3 pin) | compiled lock requires **Python ≥3.11** (`contourpy==1.3.3 Requires-Python >=3.11`) | build error: "Could not find a version that satisfies the requirement contourpy==1.3.3" |
| 3 | System lib | not needed by v1.3 pins | GPU-adjacent pins need **`mariadb_config`** | build error: "OSError: mariadb_config not found" |
| 4 | Compiler | not needed | GPU-adjacent pins need **`gcc`** | build error: "error: [Errno 2] No such file or directory: 'gcc'" |

The chain is the point: **no single build accommodation makes the bare bump
green** — each fix exposes another v1.5 delta. That is exactly the
one-variable-at-a-time problem the milestone-(d) gate exists to surface BEFORE
the per-module re-graft (Epic 2) starts.

## Contract suite (green on v1.3, proven on the fresh v1.3 build)

The suite itself is verified GREEN on a freshly-built v1.3 retriever image
(current source, post-1.4 cleanup):

| Target | Result |
|--------|--------|
| Dev venv (pure logic) | 16 passed, 3 skipped |
| `genie-ai-retriever-v13-contract` (fresh build, real comps) | 26 passed, 7 skipped (dataprep-only tests skip per-module) |
| `genie-ai-dataprep-arango` (existing v1.3) | 21 passed, 12 skipped (retriever-only tests skip per-module) |

Sensitivity (no green-on-green): the wire test asserts the 6 kwargs land with
EXACT values; the label-filter test asserts the excluded-document set + the
`filter_clause=` kwarg reaches the vector search; the ingest test asserts chunk
shape; the telemetry test asserts the dashboard-referenced span names are
emitted; the e2e test asserts the label `search_start` roundtrip + streaming
metadata shape.

## Artifacts

- Suite: `genie-ai-overlay/contracts/` (README documents invocation + sensitivity).
- CI: `contract-in-image` stage (`contract:retriever-arango`,
  `contract:dataprep-arango`) + manual `contract-red-run:retriever-v1.5` job
  that rebuilds the bare v1.5 image and captures the failure log as an artifact.
- This evidence log: `_bmad-output/implementation-artifacts/red-run-v1.5-bare.md`.

## Handoff to Epic 2

The red-run says: re-graft order is retriever → reranker → dataprep → chatqna,
one commit per module, with each module's contract test going green again AFTER
its re-graft. The first concrete re-graft task (Story 2.3) starts from this
evidence: re-point `REQ_PATH` to the compiled lock, move to the Python 3.11
base, and add the system libs the v1.5 pins need — then the contract suite
re-greens against the RE-GRAFTED v1.5 image.
