---
title: 'Story 1.4 — Enforce OPEA-free with a CI gate'
type: 'feature'
created: '2026-11-19'
status: 'in-progress'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '6c72cd95cccf5ded8b51ba94793dd620f60409a3'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** AD-1 makes the agentic path OPEA-free **structurally**, not by discipline: a future contributor who imports the `comps` package (or vendors an OPEA tree at build time) into an agent-path package would break the constraint silently — the pipeline stays green and the OPEA coupling lands with the next merge. The only check today is `agent-service.test.js`, which scans two hardcoded file lists of one package for one import form. Nothing is extensible, nothing covers build-time downloads, and nothing fails the pipeline.

**Approach:** One new tree-walking static repository check in `tests/config-validator/`, driven by a manifest that classifies every package under `components/` as agent-path or not (each non-agent-path entry carries its reason). The check scans the agent-path packages for `comps` imports (static and dynamic) and for OPEA build-time downloads (clone URLs, OPEA base images, vendored stages), and asserts its own CI trigger so a violation cannot land un-policed.

## Boundaries & Constraints

**Always:**
- Static repository check only: the gate inspects sources and dependency declarations; it never runs a service, a suite or an image.
- The agent-path list is data, not code: adding a package is a manifest edit, never a code change.
- Every package under `components/` is classified. A package that is not agent-path carries the reason it is not — an unclassified new package fails the gate (no silent narrowing).
- The scope note travels with the gate: what the gate cannot see is written down where a reader of the gate will find it.
- All artefacts (code, comments, docs) in English.

**Never:**
- No runtime check of the BFF's call graph: grep cannot see which URL the agentic branch targets at runtime. That leg is Epic 3 story 3.1's routing-helper test, and the gate says so instead of pretending to cover it.
- No scan of the OPEA overlay (`genie-ai-overlay/`): the overlay is where the `comps` package legitimately lives.
- No change to any service's behaviour, no dependency change, no runtime configuration change.
- No CI execution of the e2e suite or the venue-capture suite (operator ruling).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| CLEAN_TREE | agent-path package with no OPEA reference | the gate passes; the scanned file set is non-empty | an empty scan fails the anti-vacuity floor |
| COMPS_IMPORT | `from comps.chunking import X` / `import comps.x` / `importlib.import_module("comps.x")` in an agent-path package | the gate fails, naming the file and the import form | n/a |
| OPEA_BUILD_REF | an agent-path Dockerfile/requirements file naming an OPEA clone URL, an `opea/*` base image, a vendored OPEA stage, a `comps` path on `PYTHONPATH` or a `pip install … comps` | the gate fails, naming the file and the marker | n/a |
| NEW_PACKAGE | a new directory under `components/` | the gate fails until the package is classified in the manifest | n/a |
| NO_TRIGGER | the `config:validate` job's `rules:changes` no longer covers an agent-path package | the gate fails: a violation could land without the pipeline noticing | n/a |

</frozen-after-approval>

## Code Map

- `tests/config-validator/__tests__/agent-service.test.js` — the check this story replaces in scope: scans `components/agent-service/*.py` + `components/agent-service/tests/*.py` for `/^\s*(?:from|import)\s+comps\b/m` only. Superseded by the new gate; its rule may stay (it is cheap) but the new gate is the contract.
- `tests/config-validator/__tests__/stray-copy-artifacts.test.js` — the house precedent for a tree-walking gate: `git ls-files` enumeration, an anti-vacuity floor, a mutation-proof detection matrix, and the assertion that the gate runs in the pipeline that can introduce the violation (`parseGitlabCiJobChanges` + the fnmatch dialect `rules:changes` uses).
- `tests/config-validator/validators/temp-tree.js` — `withTree(prefix, files, fn)`: the throwaway-tree helper for the mutation tests.
- `tests/config-validator/validators/parse-compose.js` — `parseGitlabCiJobChanges(filePath, jobNames)` → the `rules:changes` globs per job.
- `.gitlab-ci.yml` — the `config:validate` job (stage `config`, `apk add bash git`, `npm ci` + `npm test` in `tests/config-validator`); its `rules.changes` list is the trigger to extend.
- `scripts/ci/config-parity-allowlist.json` — the house precedent for a CI-gate policy manifest in `scripts/ci/`.
- `components/agent-service/` — the one agent-path package today (9 tracked files, no `comps` reference at all, OPEA mentions only in comments).
- `genie-ai-overlay/**/Dockerfile*` — the real forms of an OPEA build-time download: `ARG OPEA_REPO_URL`, `git clone … GenAIComps`, `FROM opea/*`, `COPY --from=opea_base /src/comps/`, `ENV PYTHONPATH=…/app/comps/…`.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/ci/agent-path-packages.json` — the manifest: `agentPathPackages` (scanned) and `otherPackages` (not scanned, each with a reason). The union covers every directory under `components/`.
- [x] `tests/config-validator/__tests__/opea-free-gate.test.js` — the gate: manifest validation, `comps` import detection (static + dynamic), OPEA build-time marker detection, the anti-vacuity floor, the mutation matrix, and the CI-trigger assertion.
- [x] `.gitlab-ci.yml` — the `config:validate` job's `rules:changes` gains the agent-path package globs and the manifest path, so the job runs when an agent-path package or the manifest changes.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` — the story row moves to `review` with the implementation.

**Acceptance Criteria:**
- Given the repository as it stands, when the config-validator suite runs, then it passes and the new gate reports no violation.
- Given an agent-path package, when a file imports `comps` in any of its forms, then the gate fails naming the file and the form.
- Given an agent-path package, when one of its build files names an OPEA build-time source, then the gate fails naming the file and the marker.
- Given a package under `components/` that the manifest does not classify, when the gate runs, then it fails: the candidate set cannot shrink silently.
- Given the `config:validate` job, when its `rules:changes` are inspected, then every agent-path package and the manifest itself is covered by a glob of the job.
- Given a deliberate violation committed on a scratch branch, when the gate runs, then it turns red — verified once, recorded in this story.
- Given the gate's scope note, when a reader asks what it cannot see, then the answer (the BFF's runtime call graph, covered by the E3 routing-helper test, not by grep) is written in the gate itself.

## Implementation Notes

- **The manifest, not a hardcoded list.** `scripts/ci/agent-path-packages.json` classifies every directory under `components/` into `agentPathPackages` (scanned) or `otherPackages` (not scanned, each with a reason). The gate fails when a new directory appears unclassified: the failure mode of a hand-written candidate list is a gate that stays green because nobody remembered to extend it, and the reason carried by each `otherPackages` entry is what makes the classification a decision rather than an omission.
- **The BFF is not agent-path yet, and says so.** `components/gov-chat-backend` sits in `otherPackages` with the reason that its agentic routing branch lands in Epic 3 story 3.1 — that story moves it into `agentPathPackages`. Its runtime call graph is invisible to grep in any case (the gate's scope note), so listing it early would buy nothing and cost a false sense of coverage.
- **What the gate cannot see** (the scope note, kept in the gate's header): the BFF's runtime call graph — grep cannot tell which URL an agentic branch targets at runtime, and that is what Epic 3 story 3.1's routing-helper test covers; the reachability of a `comps` symbol through an alias or a re-export; the OPEA coupling inside the overlay itself, which is out of scope by design.
- **Import detection is text-level and comment-blind on purpose.** A `comps` reference in a comment fails the gate: the point of AD-1 is that the agent path never names the overlay package, and story 1.3 kept the ported module free of the name "not even in a comment". The dynamic forms (`importlib.import_module("comps…")`, `__import__("comps…")`) are covered too — a static-only check would be a hole a contributor would walk into.
- **The build-time markers are the real forms**, taken from the overlay's own Dockerfiles: an OPEA clone URL (`github.com/opea-project/…`), the clone knobs (`ARG OPEA_REPO_URL`, `ARG OPEA_VERSION`), an `opea/*` base image (including the banned `opea/translation:1.3`), a vendored OPEA stage (`COPY --from=opea_base …`), a `comps` path on `PYTHONPATH`, and a `pip install … comps`.
- **Build files only for the build markers.** The markers are searched in the package's build inputs (`Dockerfile*`, `requirements*.txt|in`, `pyproject.toml`, `setup.py|cfg`, `Makefile`, `*.sh`, `*.yml|yaml`), never in prose: a README that mentions an OPEA image is documentation, not a dependency.
- **The enumeration is the tracked tree** (`git ls-files`), exactly what the pipeline checks out. A file that is not staged is not scanned — noted in the gate's scope note so a local run is not mistaken for a pipeline result.
- **The gate asserts its own trigger**, on the `stray-copy-artifacts` precedent: the `config:validate` job must list a `**/*` glob for every agent-path package and for the manifest, or the gate fails. Without it, a violation could land in a package whose changes never trigger the job that holds the gate.
- **The red proof is a local scratch branch**: a deliberate `from comps…` committed on a scratch branch, the suite run against it, the gate observed red — the AC asks for the proof once, and a permanent mutation matrix in the gate keeps it true on every future change.
- **The workflow checkpoint was not used as a hard stop**: the operator's standing instruction for this dispatch is autonomous execution to a draft merge request, with the merge itself gated by the orchestrator's GO. The decisions a checkpoint would have collected are recorded above and in the Implementation Notes.

## Spec Change Log

## Review Triage Log

## Design Notes

- The manifest is JSON because it is data consumed by two kinds of checker (the gate and the human who extends it) and it must stay diffable in a review. The house precedent for the same thing is `scripts/ci/config-parity-allowlist.json`.

## Verification

**Commands:**
- `cd tests/config-validator && npm test` -- expected: the whole suite passes, the new gate included.
- `cd tests/config-validator && npx jest __tests__/opea-free-gate.test.js` -- expected: the gate suite passes on its own.
- `npx eslint tests/config-validator/__tests__/opea-free-gate.test.js` -- expected: no lint finding.
- `npx prettier --check tests/config-validator/__tests__/opea-free-gate.test.js scripts/ci/agent-path-packages.json` -- expected: formatting accepted.
- `bash -n .gitlab-ci.yml` -- expected: the edited pipeline still parses.
