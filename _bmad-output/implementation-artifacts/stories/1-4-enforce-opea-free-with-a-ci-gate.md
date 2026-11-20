---
title: 'Story 1.4 — Enforce OPEA-free with a CI gate'
type: 'feature'
created: '2026-11-19'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 18
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
- **The import check reads code, not prose.** A `comps` import is a coupling; a commented-out import, a trailing comment that names one and a docstring that quotes one are not. A scanner (not a regular expression) marks what is code: a `"""` that opens no docstring pairs with the NEXT `"""` under a regex, and everything between them — a real import included — looks like a string. The scanner follows the quote state instead, so a stray quote cannot swallow the file. The static forms cover the module lists Python offers (`import comps.x`, `import os, comps.x`, an alias in the list (`import os as o, comps.core`), a continuation inside the list — including several in a row and CRLF endings — and an import after another statement on the same line) and are accepted only when the package NAME sits in code — the name of a dynamic import is inside a string, so those forms are accepted when the CALL sits in code. A relative import of a local module named `comps` is not the overlay package and is not reported.
- **The package name has three spellings.** The module is `comps`, the published distribution is `opea-comps` (PyPI, 1.5) and `genai-comps` is the legacy spelling of the same package (404 on PyPI today). The dependency markers accept all three; the import markers only know the module name, because the module name is what Python imports.
- **The glob matcher speaks the dialect `rules:changes` uses.** GitLab matches with Ruby's `File.fnmatch` under FNM_PATHNAME | FNM_DOTMATCH | FNM_EXTGLOB: a `**` component followed by a slash stands for zero or more directories, a trailing `**` is an ordinary star (ONE segment), `?` is a single character and `{a,b}` expands. Reading `**` as "zero or more segments" would certify a trigger GitLab does not honour — `components/agent-service/**` covers the files directly under the package, not its subdirectories — so the matcher implements the Ruby rules and a case pins each of them.
- **The build files the markers are read in.** The classifiers are shape-aware: a Dockerfile, the Makefile family (`GNUmakefile`, `makefile`, `Makefile.<suffix>`), every lock file whatever the tool calls it (`uv.lock`, `poetry.lock`, `Pipfile.lock`), a requirements file (flat or at any depth under a `requirements` directory), `constraints.txt`, the Pipfile family, the packaging files (`pyproject.toml`, `setup.py`, `setup.cfg`), a build script or a pipeline file. A README that mentions an OPEA image is documentation, not a dependency.
- **The build-time markers are the real forms**, taken from the overlay's own Dockerfiles: the OPEA source tree (`GenAIComps`/`GenAIExamples`, from any mirror) and the OPEA organisation (`opea-project/…`), the clone knobs (`ARG OPEA_*_URL`, `ARG OPEA_*_VERSION`), an `opea/*` image under any registry (including the banned `opea/translation:1.3`, and the `ARG UPSTREAM_IMAGE=opea/…` shape the overlay uses), a stage named after the overlay (`AS comps_base_builder` — the name must carry `comps` or `opea` as a word, so `AS european_base` is not one), a vendored stage (`COPY --from=opea_base …`) or payload (`…/comps/`, copied by `COPY` or by `cp`/`rsync`/`mv`), a `comps` path on `PYTHONPATH`, a `pip install … comps`, and a dependency declaration naming it (a requirements, constraints, lock or packaging file: `comps==1.5`, `"comps"` in a dependency array, `install_requires = comps`).
- **The build files are read with their own comment rule.** A `#` starts a comment in a shell script, a Dockerfile or a YAML file when it stands at the start of a line or after a space, a tab or a `;` — not inside a word (`${PATH#/opt}` is a parameter expansion). No quote is tracked there either: an apostrophe in YAML prose is not a string delimiter, and tracking it would swallow the rest of the file and report a commented-out reference as a live one. Python keeps its own rule: a `#` starts a comment anywhere outside a string, and a string is tracked by its quotes.
- **The build markers are read with their comments stripped, and the dependency markers only in dependency files.** A Dockerfile comment that mentions the overlay, a YAML key named `comps`, a Makefile target and a tools directory called `comps-tools` are not dependencies — the markers would fire on them if the raw text were matched. A dependency declaration is a different matter: the name of the overlay package in a requirements, constraints, lock or packaging file IS a dependency, and it is reported there and nowhere else. The name must carry a version operator (or be the whole entry) to be a declaration: `comps: see the overlay` is a mention.
- **The enumeration is the tracked tree** (`git ls-files`), exactly what the pipeline checks out — for the files AND for the package directories, so a scratch directory a developer left under `components/` is not a package. A file that is not staged is not scanned — noted in the gate's scope note so a local run is not mistaken for a pipeline result.
- **The gate asserts its own trigger**, on the `stray-copy-artifacts` precedent: EVERY tracked file of every agent-path package must be matched by a glob of the `config:validate` job, and the manifest itself must be in the job's `changes` list, or the gate fails. A glob set that covers the root files in one glob and the nested files in another leaves the rest of the package un-policed, so the check is per file, not per shape. Without it, a violation could land in a package whose changes never trigger the job that holds the gate.
- **Every correction carries a pinning sample.** Each detection form has a sample that only the fixed pattern matches (an indented requirement entry, a renamed stage, `ARG OPEA_COMPS_VERSION`, `GenAIExamples`, a nested `requirements/` file, `constraints.txt`, `uv.lock`, `Pipfile`, a trailing comment, a scratch directory under `components/`, a colon-introduced statement, a capital and a lowercase suffixed Makefile), each false-positive defence has a negative sample that can fail ALONE (a build marker in a comment, a dependency line in a file that is not a dependency file, a name without a version operator, a stage whose name merely contains `opea`, a package whose name merely starts with `comps`), and the pipeline globs are pinned by mutating `.gitlab-ci.yml` — dropping, narrowing or splitting the agent-path glob turns the gate red, and the job must keep ONE glob that covers the whole package. One class cannot be pinned by a sample: deleting an assertion makes the property it guards invisible to the suite, so the two assertions that read the job's globs are protected by the config mutations rather than by a sample of their own.
- **What the trigger check enforces.** Every tracked file of every agent-path package must be matched by a glob of the `config:validate` job, and ONE glob of the job must cover the whole package: a set that covers the root in one glob and the nested files in another leaves the rest of the package un-policed the day a file lands outside the two directories it happens to cover. The globs are the job's own, parsed from `.gitlab-ci.yml` — the check asserts that they cover the gate's own file, so a synthetic glob set cannot stand in for them.
- **The red proof is a local scratch branch**: a deliberate `from comps…` committed on a scratch branch, the suite run against it, the gate observed red — the AC asks for the proof once, and a permanent mutation matrix in the gate keeps it true on every future change.
- **The workflow checkpoint was not used as a hard stop**: the operator's standing instruction for this dispatch is autonomous execution to a draft merge request, with the merge itself gated by the orchestrator's GO. The decisions a checkpoint would have collected are recorded above and in the Implementation Notes.
- **The red proof (AC 2)** — verified once, on a scratch branch, with the gate reading the real tracked tree:
  - `git worktree add /tmp/opea-free-red-proof -b chore/opea-free-gate-red-proof` from this branch's HEAD; `components/agent-service/red_proof.py` (`from comps.chunking import Chunker`) staged, and `FROM opea/embedding:1.5` appended to the package Dockerfile.
  - `npx jest __tests__/opea-free-gate.test.js` in that worktree → the case "finds no OPEA coupling in the agentic path" goes red with both violations named:
    ```
    file: components/agent-service/Dockerfile      rule: opea-build:opea-base-image
    file: components/agent-service/red_proof.py    rule: comps-import:from-import
    ```
  - The other seven cases stay green: only the violation turns the gate red.
  - The scratch worktree and its branch were removed afterwards (`git worktree list` shows neither, the branch is deleted). Nothing was pushed: the proof is local by design — a pushed red branch would run the whole pipeline on the shared instance for nothing, and the pipeline wiring is what the gate's own trigger assertion covers.
- **Verified locally**: the config-validator suite (584 tests / 15 suites, green), eslint and prettier on the new files, and the `bash -n` over the pipeline script blocks (the `ci-shell-gates` case of the same suite). The suite's #1716 behavioural probe needed `tests/e2e`'s pinned eslint — installed locally, as CI does.
- **Not exercised**: the pipeline itself (no local runner); the e2e suite and the venue-capture suite never run in CI (operator ruling), and this story adds no test execution to the pipeline — the gate is a static repository check.
- **The branch was re-synced with the umbrella, not rebased.** The umbrella branch advanced while the story was open (the story 1.3 "done" follow-up landed), so `sprint-status.yaml` diverged: the merge-ref pipeline was built on a conflicted merge, the merge result carried the target's tree, every change-gated job — the gate's own job included — was SKIPPED, and the pipeline reported red on two unrelated jobs. The umbrella tip was merged into the story branch (a merge, not a rebase: the merge-train rule forbids hand-rebasing) and the conflict was resolved by taking the umbrella's story 1.3 row (`done`), this story's row (`review`) and this story's stamp. The merge-ref pipeline then ran the gate.
- **The red on the first correction pipeline was not this story's code**: `test:okf-server` failed on 31 cases of `components/okf-server/__tests__/ragas-suite-service.test.js` — an async-timing flake in the RAG evaluation harness (a run observed in the phase `building-knowledge-graph` where the test expected `synthesizing-questions`), in a package this diff does not touch; the umbrella's own pipeline for the same commit was green. `gemnasium-python-dependency_scanning` failed on the artifact upload (`403 Forbidden` from the coordinator), the instance's known artifact-upload problem — the scan itself completed.

## Spec Change Log

## Review Triage Log

Global round 1 (`/code-review`, base `feat/agentic-foundations/prd` @ 6c72cd95c → head d6a1044a1) — 10 findings, all dispositioned:

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| 1 | The `opea-requirement` marker is line-anchored, so an indented or quoted dependency entry escapes it; the build-file pattern misses nested requirements directories, `constraints.txt`, `uv.lock` and `Pipfile` | important | **Fixed** — the marker accepts an indented/listed/quoted entry, a second marker (`opea-dependency-entry`) catches a quoted package name in a `pyproject`/`setup.py` array, the build-file pattern covers the four missing file families, and the matrix carries a sample per form |
| 2 | The CI-trigger assertion probes one nested path per package, so a narrowed glob (`…/tests/**/*`) passes while the root-level files are un-policed | important | **Fixed** — the assertion now requires a glob that matches a root-level file AND a nested file |
| 3 | Three build markers are keyed on the overlay's exact spellings (a registry-qualified image, a slashless `PYTHONPATH`, a renamed stage all escape) | important | **Fixed** — the image marker is registry-agnostic, the `PYTHONPATH` marker accepts an optional trailing slash, the vendored stage is keyed on a stage name carrying the overlay's name and a second marker on the copied `/comps/` payload, and the clone marker is keyed on the OPEA source-tree names as well as the OPEA organisation |
| 4 | `gitlab-glob.js` duplicates the fnmatch matcher inlined in `stray-copy-artifacts.test.js` | important | **Fixed** — the stray-copy gate now imports the shared helper and its inline copy is deleted; one dialect, one answer |
| 5 | The Implementation Notes claim a `comps` reference in a comment fails the gate — it did not (the static forms were line-anchored) | important | **Fixed** — the gate reads code: docstrings and comment lines are stripped before the import forms are matched, and the notes state the real behaviour |
| 6 | The sprint-status row and the story's front matter were not at `review` / `in-review` while the siblings were | important | **Fixed** — the row moves to `review`, the front matter to `in-review` |
| 7 | The Verification recipe runs `bash -n .gitlab-ci.yml`, which cannot parse a YAML file | important | **Fixed** — the recipe runs the `ci-shell-gates` case of the same suite, which is the real check |
| 8 | The scope note claims the enumeration is the tracked tree, but the package directories came from `readdirSync` | nit | **Fixed** — the package enumeration is derived from `git ls-files` too |
| 9 | The Verification commands run `npx` from the repository root (no `node_modules`, no ESLint config there), and no repository gate formats the manifest | nit | **Fixed** — the commands run from `tests/config-validator`, where the binaries are pinned. The manifest stays outside the repository's format gate on purpose: widening the root glob to JSON would pull `scripts/ci/config-parity-allowlist.json` into a check it never had (recorded in the Verification block) |
| 10 | `components/okf-server/services/safe-frontmatter.js:19` — the file header contradicts its own docstring about `stringify` parsing | pre-existing | **Already handled** — #2008 (item 12, `status::backlog`) already carries it; the finding is on the umbrella branch, not introduced here, and this diff does not widen to fix it |

Fix-review round 1 (`FIX-REVIEW`, correction diff `d6a1044a1` → `9cbdbb07a`) — 1 critical, 4 important, 2 minor:

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| C1 | The docstring regex is a blind non-greedy match: a `"""` that opens no docstring pairs with the next one and swallows a real `import comps.core` — a false negative against the base revision | critical | **Fixed** — a quote-state scanner replaced the regex; the import forms are matched against the raw file and accepted only when they START in code; a sample with a stray `"""` and a real import pins it |
| I1 | A trailing comment survives the comment strip, so a commented-out dynamic import is reported — the notes promise the opposite | important | **Fixed** — the scanner strips comments to the end of the line, wherever they start; a trailing-comment sample pins it |
| I2 | The trigger assertion accepts a glob set that leaves the Dockerfile, the requirements and `src/` un-policed | important | **Fixed** — every tracked file of every agent-path package must be matched by a glob; the check is per file, and the split-glob and root-only sets are pinned as uncovered |
| I3 | The widened build markers fire on prose, a YAML key, a Makefile target and a tools directory | important | **Fixed** — the build files are read with their comments stripped, the dependency markers apply only to dependency-declaration files, the `PYTHONPATH` marker requires a `comps` path segment, and the dependency markers require a version operator; a negative sample per family pins each |
| I4 | Eight of the corrections were not pinned by any sample: reverting them kept the suite green | important | **Fixed** — a sample now exists for each: an indented requirement entry, a renamed stage, `ARG OPEA_COMPS_VERSION`, `GenAIExamples`, a nested `requirements/` file, `constraints.txt`, `uv.lock`, `Pipfile`, a trailing comment and a scratch directory under `components/`; the pipeline globs are pinned by mutating `.gitlab-ci.yml` (dropping, narrowing, splitting) |
| M1 | The story and the manifest describe the pre-correction marker set | minor | **Fixed** — both list the shipped set |
| M2 | `RUN cp -R …/comps/ …` — the overlay's own vendoring shape — matched no marker | minor | **Fixed** — a copied-payload marker covers a `/comps/` payload copied by a shell command, next to the `--from=` payload marker |

Fix-review round 2 (`FIX-REVIEW`, correction diff `9cbdbb07a` → `65a3fccf3`) — 0 critical, 3 important, 4 minor:

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| I-1 | The stray-quote sample carries ONE `"""`, so the old blind regex never fired on it: the critical fix of round 1 was unpinned | important | **Fixed** — the sample now carries the second `"""` that makes the old regex swallow the import; reverting the scanner to that regex turns the suite red |
| I-2 | Three of the four false-positive defences are not individually pinned — reverting the comment strip, the dependency-file restriction or the version operator kept the suite green | important | **Fixed** — each defence now has a negative sample that can fail alone: a build marker in a Dockerfile comment, a dependency line in a file that is not a dependency file, a name without a version operator inside a dependency file; the stage-name boundary got its own sample too |
| I-3 | The per-file trigger assertion is unpinned: replacing the job's real globs with a synthetic set keeps everything green | important | **Fixed** — the job's real globs are narrowed in place and the check must then find files uncovered, so the check reads the real globs |
| m1 | `opea-overlay-stage` has no word boundary: `AS european_base` trips it ("european" contains "opea") | minor | **Fixed** — the stage names must carry `comps` or `opea` as a word; a negative sample pins it |
| m2 | The import forms are line-anchored: `import os, comps.core` and `x = 1; import comps.core` are not detected | minor | **Fixed** — the static forms cover the module lists Python offers, and the package name (not the match start) is what must sit in code |
| m3 | `setup.cfg`'s `install_requires = comps` is not detected | minor | **Fixed** — the dependency-entry marker also accepts an unquoted name in a dependency assignment |
| m4 | `ARG UPSTREAM_IMAGE=opea/…` — a shape the story names — had no sample | minor | **Fixed** — the sample exists |

Fix-review round 3 (`FIX-REVIEW`, correction diff `65a3fccf3` → `009599e9b`) — 0 critical, 1 important, 5 minor:

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| I-3 | The trigger assertion of the previous round cannot fail for the defect it answers: a glob set that covers the root in one glob and the nested files in another passes the check, and a synthetic glob set satisfies it as readily as the job's real one | important | **Fixed** — the job must now have ONE glob that covers every tracked file of the package (the split is red), the check must read the job's real globs (the gate's own file must be covered by them), and the redundant narrowing assertion was dropped |
| m1 | `opea-pip-install` has no word boundary: `pip install comps-tools` is flagged | minor | **Fixed** — the boundary matches its siblings; a negative sample pins it |
| m2 | The dependency-assignment form accepts a name that merely contains `comps` (`comps-tools`) | minor | **Fixed** — the boundary matches its siblings; a negative sample pins it |
| m3 | A colon-introduced statement (`if TYPE_CHECKING: import comps.core`) is not detected | minor | **Fixed** — the statement anchor carries the colon; a sample pins it |
| m4 | The story's pinning claims are stronger than the code | minor | **Fixed** — the notes now state what is pinned and what cannot be (an assertion cannot pin itself) |
| m5 | The package-name offset is computed with a search over the match, which a later pattern edit could break silently | minor | **Fixed** — the offset comes from the match indices (`d` flag, named group) |

Global round 2 (`/code-review` over the whole diff at `f44ed0435`) — 4 important, 5 nit:

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| G-1 | The glob matcher does not implement the dialect `rules:changes` uses: a trailing `**` matches ONE segment in Ruby's fnmatch (FNM_PATHNAME), `?` is a single-character wildcard and `{a,b}` expands — so the gate could certify a trigger GitLab will not honour | important | **Fixed** — the matcher implements the Ruby rules (a `**` component followed by a slash matches zero or more directories, a trailing `**` is one segment, `?` is one character, braces expand), and a case pins each rule |
| G-2 | The pip-install marker misses `opea-comps`, the real published distribution (PyPI `opea-comps` 1.5; `genai-comps` 404s) | important | **Fixed** — the markers accept `opea-comps`, the legacy `genai-comps` and the bare module name; a sample pins each |
| G-3 | The same spelling gap in the two dependency markers | important | **Fixed** — as above |
| G-4 | The comment stripping applies Python's rule to every file type: in a shell script, a Dockerfile or a YAML file a `#` starts a comment only at the start of a line or after a space, so `${PATH#/opt} && pip install opea-comps` lost the install | important | **Fixed** — the build files are read with their own comment rule; a sample pins it |
| G-5 | The same scanner models quotes in every file type: an apostrophe in YAML prose flipped the scanner into string mode and reported a commented-out reference as a live violation | nit | **Fixed** — the build files model no quotes; a sample pins it |
| G-6 | The build markers are not searched in `.py` files, so a module that installs the package at runtime is not covered | nit | **Stated** — the limitation is in the gate's scope note and in these notes |
| G-7 | The story's front matter says `review_loop_iteration: 0` while the log records five rounds | nit | **Fixed** — the counter matches the log |
| G-8 | The recorded test count does not match the shipped tree | nit | **Fixed** — the count is the one the current tree produces |
| G-9 | The manifest is not covered by any schema gate | nit | **Fixed** — the gate pins the manifest's shape: the partition covers every package, the paths are repository-relative without a trailing slash, every entry carries a reason and every path exists |

Fix-review round 4 (`FIX-REVIEW`, correction diff `f44ed0435` → `3d81c5c64`) — 0 critical, 2 important, 3 minor:

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| I-1 | The build-comment rule accepts only a space before the `#`: a tab-indented comment is read as text (a false violation out of a comment) and a comment after a stage name breaks the end-anchored marker (a lost match) | important | **Fixed** — a space, a tab and a `;` are comment contexts; a tab-indented comment is a sample |
| I-2 | Two spellings were not pinned: the dependency-entry marker could lose `opea-` and the pip marker could lose `genai-` with the suite green | important | **Fixed** — a sample per spelling: `opea-comps` in a dependency array, `genai-comps` in a requirements file, `opea-comps` in an `install_requires` assignment, `genai-comps` under `pip install` |
| M-1 | The matcher's doc comment over-claims: the bracket classes and the backslash escapes are not modelled | minor | **Fixed** — the doc says so, and notes that the difference is conservative |
| M-2 | A `#` inside a quoted string still starts a comment in a build file, so a coupling after it on the same line is not seen | minor | **Stated** — the limitation is in the gate's scope note |
| M-3 | The Review Triage Log lists the rounds out of chronology | minor | **Fixed** — the rounds are in order |

Fix-review round 5 (`FIX-REVIEW`, correction diff `c0d9f4c84` → `919c09b5c`) — 0 critical, 0 important, 1 minor:

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| 1 | The log does not record this round, and the loop counter counts one round short | minor | **Fixed** — this table and the counter are the record |

Global round 3 (`/code-review` over the whole diff at `53096455e`) — 1 important, 3 nit:

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| G-1 | The build and dependency classifiers miss real file shapes: a Makefile suffix (`Makefile.linux`), `GNUmakefile`, a lowercase `makefile`, `poetry.lock`, and a requirements directory deeper than one level | important | **Fixed** — the classifiers are shape-aware functions: the Makefile family (`GNUmakefile`, `makefile`, `Makefile.*`), every lock file (whatever the tool calls it), the Pipfile family, and every file under a requirements directory at any depth; the lock family, the requirements depth and the Makefile family each carry marker samples (a capital and a lowercase suffixed Makefile, and a GNUmakefile — each member's sample carries the same marker; reverting a family MEMBER turns its own sample red, reverting the SUFFIX variant turns both suffixed samples red) |
| G-2 | A backslash-continued module-list import (`import os, <newline> comps.core`) is legal Python and escaped the import-statement matcher | nit | **Fixed** — the module-list separator crosses a line continuation; a sample pins it |
| G-3 | A CRLF-terminated Dockerfile line breaks the end-anchored stage marker | nit | **Refuted** — in JavaScript `$` matches before any line terminator, so the marker already matches a CRLF line (verified in node); the carriage return is still stripped, and the sample documents the case |
| G-4 | The partial-glob mutation check runs on the live tree and would false-alarm on a future package that happens to carry only the two shapes it names | nit | **Fixed** — the check runs on a synthetic shape list |

Fix-review round 6 (`FIX-REVIEW`, correction diff `53096455e` → `8fd920fab`) — 0 critical, 1 important, 2 minor:

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| I-1 | The Makefile-family widening survives its own revert with the suite green: the only new Makefile sample carries no marker, so nothing turns red when `GNUmakefile` stops being a build file | important | **Fixed** — a capital `Makefile.linux` and a lowercase `makefile.linux` sample, both installing the overlay package, pin the suffix variant and EACH alternative of the `[Mm]` class (revert one alternative and exactly one of the two samples turns red); the GNUmakefile entry carries the same marker (later proven necessary: while it held an empty-rules control, reverting `GNUmakefile` from the family left the suite green). One sample cannot pin both alternatives — the first correction's single capital sample left the lowercase direction green |
| M-1 | A stale bullet still listed the pre-correction classifier, one line under the shape-aware bullet | minor | **Fixed** — the stale bullet is folded into the shape-aware one |
| M-2 | Sibling continuation shapes (a continuation after `import` or `from`, or before the comma) are legal Python and still escape | minor | **Stated** — the scope note records the family boundary: only a continuation inside a module list is crossed |

Fix-review round 7 (`FIX-REVIEW`, correction diff `8fd920fab` → `bdb326126`) — 0 critical, 1 important, 2 minor. The reviewer ran the mutation matrix themselves (baseline green, suffix-drop red, rule-strip red) and proved the round-6 correction's own disposition false: a single capital sample cannot pin the `[Mm]` class (reverting lowercase support leaves the suite green).

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| I-1 | The round-6 row claims the `Makefile.linux` sample "pins the suffix and the case at once"; the reviewer's `[Mm]`→`M` mutation leaves the suite green — the case is unpinned and the row overclaims | important | **Fixed** — a second, lowercase `makefile.linux` sample completes the pin (each alternative of the class is now proven by its own sample going red on revert); the row states exactly what each sample proves |
| M-1 | The Makefile samples sat in the dependency table under a test named for dependency declarations, though they pin a build marker | minor | **Fixed** — the GNUmakefile control and both Makefile samples moved to the build-marker table |
| M-2 | The story's pinning-sample inventory was not extended with the Makefile samples | minor | **Fixed** — the inventory lists them |

Fix-review round 8 (`FIX-REVIEW`, correction diff `bdb326126` → `364a07e3e`) — 0 critical, 0 important, 2 minor; READY. The reviewer re-ran the full mutation matrix (baseline green; suffix-drop red; `[Mm]`→`M` red on the lowercase sample; `[Mm]`→`m` red on the capital sample; rule-strip red) and re-verified the round-7 premise at the base commit (the `[Mm]`→`M` mutation was green there, red at HEAD — the fix is genuine). All three round-7 findings audited FIXED.

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| M-1 | The new code comment lumped the suffix into the "exactly one sample turns red" clause; a suffix revert turns BOTH samples red | minor | **Fixed** — the comment separates the two cases |
| M-2 | The appended round-7 table glued the `## Design Notes` heading to its last row, breaking the heading in Markdown | minor | **Fixed** — the newline restored (the round-8 append itself re-glued the heading one row down; the glue is removed in the round-9 correction below) |

Global round 4 (`/code-review`, span since the last global `53096455e` → `8de388e2d`) — 3 important, 1 pre-existing, 3 nit; every mutation claim re-executed by the reviewer:

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| G4-1 | A CRLF line continuation (`import os, <CR><LF> comps.core`) escapes the import matcher: the continuation is `\\\n`, not `\\\r?\n` — a Windows-committed file hides the coupling | important | **Fixed** — the continuation crosses `\\\r?\n`; a CRLF sample pins it |
| G4-2 | The `GNUmakefile` alternative of the Makefile family is unpinned: its sample holds an empty-rules control, so reverting the alternative leaves the suite green — the exact class round-6 I-1 rated important | important | **Fixed** — the GNUmakefile sample carries the marker now; its revert turns it red. The empty-rules control had proven nothing about detection in three rounds |
| G4-3 | The round-8 M-2 disposition "the newline restored" was false at HEAD: the append had re-glued `## Design Notes` one row down | important | **Fixed** — the glue removed; the round-8 row amended to record it. (The global-4 append itself re-glued the heading into the G4-7 row — caught by the chain's f=0 review, removed in its correction below.) |
| G4-4 | An `as` alias on a NON-final module (`import os as o, comps.core`) breaks the module-list walk — legal Python, pre-existing gap on the line this span kept editing | pre-existing | **Fixed** — the prefix items accept an optional alias; two samples pin it |
| G4-5 | Only ONE continuation is crossed (`?` quantifier); two in a row escape while the scope note claims the shape | nit | **Fixed** — the continuation quantifier is `*`; a two-continuation sample pins it; the scope note restated |
| G4-6 | `stripBuildComments` deletes every CR, so a lone-CR line ending merges a comment with the code that follows and hides the marker | nit | **Fixed** — CR normalizes to LF; a lone-CR sample pins it |
| G4-7 | The lock-file widening admits non-Python locks: a yarn.lock entry for a package literally named `comps` (`comps@^1:`) fires the requirement marker — a deliberate widening without a pinned boundary | nit | **EXTRACTED** — issue #2024 (`status::backlog`, never promoted): per-lock-format marker sets, or scoping the `@` alternative inside Python locks only |

Fix-review round 9 (`FIX-REVIEW`, correction diff `8de388e2d` → `80fd3954b`, f=0 of the global-4 chain) — 0 critical, 1 important, 0 minor. The reviewer re-ran the whole mutation matrix (all five pins RED on exactly their own sample; negative matrix green throughout; full suite 584/584) and audited issue #2024 on GitLab.

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| I-1 | The global-4 append re-glued the `## Design Notes` heading INTO the G4-7 table row (`\|## Design Notes`, no standalone heading line remains) — the same seam that produced G4-3 and the round-8 defect, now inverted | important | **Fixed** — the heading restored as its own line, with the blank line after it; both G4-3's and the round-8 M-2 amendment's claims are true at HEAD now |

All seven global-4 findings audited: six FIXED (each mutation-proven by the reviewer), G4-7 FIXED as EXTRACTED.

Fix-review round 10 (`FIX-REVIEW`, correction diff `80fd3954b` → `3abd2a4c2`, f=1 of the global-4 chain) — 0 critical, 1 important, 1 minor:

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| I-1 | The round-8 M-2 row's attribution clause still named the global-4 correction as the remover of the glue, but the global-4 append is what re-glued it; the removal happened in the round-9 correction | important | **Fixed** — the clause names the round-9 correction |
| M-1 | The `## Design Notes` heading had no blank line before it — the seam that cost four rounds of re-gluing | minor | **Fixed** — the blank line added, ending the recurrence class |

Global round 5 (`/code-review`, span since the last global `8de388e2d` → `d8911e5cd`) — 0 critical, 0 important; 1 pre-existing, 4 nit; the reviewer re-verified every pin and probed detection, false-positive boundaries and ReDoS empirically:

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| G5-1 | A UTF-8 BOM hides a FIRST-statement import (`\uFEFFimport comps.core`): the `^` anchor cannot match after the BOM bytes — the sibling of the CRLF class G4-1 fixed | pre-existing | **Fixed** — both static patterns' leading anchors admit `\uFEFF`; a BOM-first sample pins each form |
| G5-2 | The rewritten Makefile comment re-lumped the suffix into "exactly its own sample turns red"; a suffix revert turns BOTH suffixed samples red — the same false claim round-8 M-1 had fixed | nit | **Fixed** — the comment and the story's G-1 row separate the two cases again |
| G5-3 | The CR-to-LF normalization makes a `#` after a MID-LINE lone CR a comment where a shell would run the text | nit | **Documented** — the scope note states the lone-CR-as-terminator choice and its miss-direction cost |
| G5-4 | The alias extension added no negative pin: an alias NAMED `comps` (`import os as comps, sys`) must stay green | nit | **Fixed** — the negative sample added |
| G5-5 | The round-10 summary line glued to its table — the seam class again, one line above the round-10 fix | nit | **Fixed** — the blank line added |

Fix-review round 11 (`FIX-REVIEW`, correction diff `d8911e5cd` → `8fd70d738`, f=0 of the global-5 chain) — 0 critical, 0 important, 1 minor. The reviewer re-ran the BOM mutations (each red on exactly its own sample), probed the BOM false-positive surface (mid-line, between statements, in comments — all clean), verified the alias negative's isolation and the Makefile family's per-member behaviour, and ran the full suite (584/584).

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| M-1 | The Global-5 block itself recreated the table seam twice (its summary line glued under the G5-5 row, and the round-9 closing sentence stranded below it) and inverted the intro-then-table convention | minor | **Fixed** — the region rebuilt in convention order: intro, blank, table for every round; the round-9 closing back in its own block |

Fix-review round 12 (`FIX-REVIEW`, correction diff `8fd70d738` → `0c72fefe6`, f=1 of the global-5 chain) — 0 critical, 1 important, 1 minor:

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| I-1 | The round-11 correction re-glued the seam one block lower: the round-11 table's last row sat flush against `## Design Notes` — round-10 M-1's "ends the recurrence class" was false at HEAD | important | **Fixed** — the blank line before the heading restored (verified byte-exact before commit this time) |
| M-1 | `review_loop_iteration` read 17 against a log of 16 events (the rebuild bumped the counter twice for one round) | minor | **Fixed** — set to 16 (true at that head), then to 18 after the round-13 append, per the convention the f=2 review proved: the counter equals the total round blocks AFTER the head's own append (a reviewer counting before the append and one counting after will disagree by one — both are right at their own head) |

Fix-review round 13 (`FIX-REVIEW`, correction diff `0c72fefe6` → `5181ff3e8`, f=2 of the global-5 chain) — 0 critical, 1 important, 0 minor. The reviewer byte-verified the seam repair (zero glue lines file-wide), traced the counter across 14 consecutive commits (each set it to the total after its own append) and audited the round-12 rows against the actual diff:

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| I-1 | The counter read 16 against a log of 17 round blocks at this head — the correction moved the off-by-one from +1 to −1; the round-12 M-1 disposition asserted "matching the log", false at HEAD | important | **Fixed** — the counter set to the convention value (18 at the round-13 head), the round-12 M-1 row amended to record the full sequence |

## Design Notes

- The manifest is JSON because it is data consumed by two kinds of checker (the gate and the human who extends it) and it must stay diffable in a review. The house precedent for the same thing is `scripts/ci/config-parity-allowlist.json`.

## Verification

**Commands:**
- `cd tests/config-validator && npm test` -- expected: the whole suite passes, the new gate included.
- `cd tests/config-validator && npx jest __tests__/opea-free-gate.test.js` -- expected: the gate suite passes on its own.
- `cd tests/config-validator && npx jest __tests__/ci-shell-gates.test.js` -- expected: the edited `.gitlab-ci.yml` script blocks still pass the shell-syntax gate. (The pipeline file is YAML: `bash -n .gitlab-ci.yml` does not parse it — the shell gate of the same suite is the real check.)
- `cd tests/config-validator && npx eslint __tests__/opea-free-gate.test.js validators/gitlab-glob.js` -- expected: no lint finding. The lint and format binaries are the ones `tests/config-validator` pins — run from there, not from the repository root, which carries no `node_modules` and no ESLint config.
- `cd tests/config-validator && npx prettier --check __tests__/opea-free-gate.test.js validators/gitlab-glob.js ../../scripts/ci/agent-path-packages.json` -- expected: formatting accepted. No repository gate formats the manifest: the root format script covers `scripts/**/*.{js,cjs}` only, and widening it to JSON would drag `scripts/ci/config-parity-allowlist.json` into a format check it has never had — out of this story's scope.
