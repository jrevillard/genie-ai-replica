---
title: 'Story 1.10 — Attest the chart identity of the deployed baseline'
type: 'feature'
created: '2026-11-19'
status: 'in-progress'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '017e9f2a0'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/stories/1-2-baseline-the-deployed-stack-v03.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The V03 record reconciles the running deployment against the repository's chart source, but it never says WHICH chart the deployment runs. A reader cannot tell whether the source the record reconciles against is the chart the running release was rendered from, or a later state of it — the defect that let story 1.2's identity gate fail open twice before it was trimmed.

**Approach:** The capture reads the chart identity from the cluster objects that attest it — the chart version the HelmRelease's release history records, and the rendered chart the Helm release secret holds — and compares the local chart tree with it file by file. Every difference is listed with a disposition; a comparison that cannot be established is an unresolved difference that fails the capture, never a silent pass.

## Boundaries & Constraints

**Always:** read-only against the cluster; the identity comes from cluster objects, never from a moving ref; the comparison fails closed; no secret value ever reaches the record; the record names the chart the deployment runs and the commit of this repository that carries it.

**Never:** never compare the local chart tree against the source's current ref — that ref moves and is not the commit the release was rendered from; never read the release secret's rendered manifest or its effective (overlay) values; never widen the environment comparison past the workloads the chart renders — the retrieval tier plus the three non-retrieval tiers this story adds; never let an undispositioned difference pass.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Release whose chart is in this repository | the deployed revision's release secret holds a chart this checkout carries | the record states the attested version, the source commit, and IDENTICAL | none |
| Local chart source differs | a template, a value leaf, the lock or the version differs | each difference is a dispositioned row | none |
| The release does not render from a GitRepository | the sourceRef kind is not GitRepository | UNRESOLVED — no commit attests the chart | capture exits 2 |
| The attested chart carries no template | the release secret holds a chart with no template | UNRESOLVED — an empty commit attests nothing | capture exits 2 |
| A commit this checkout does not know | the attested chart matches no commit of this checkout | UNRESOLVED — the chart the deployment runs is unknown here | capture exits 2 |
| The release secret is missing or unreadable | no release secret for the deployed revision | UNRESOLVED — the chart the deployment runs cannot be read | capture exits 2 |

</frozen-after-approval>

## Code Map

- `scripts/baseline/capture-deployed-baseline.py` — the capture. `OPEA_WORKLOADS` (line 62) maps component → chart template and `WORKLOAD_ENV_MAPS` (line 77) maps component → the values path of its operator env map; `capture_release` (line 812) reads the HelmRelease (history, sourceRef, storage namespace); `local_chart_version` (line 917); the chart identity section — `attested_chart`, `source_commit`, `chart_differences`, `chart_identity` (line 1345) and `chart_identity_rows` (line 1435); `resolve_source` (line 1682) and `compare_workload` (line 1772) are the three-layer comparison; `render_markdown` (line 1897) writes the record; `collect_discrepancies` (line 2374) is the exit gate; `capture` (line 2543) assembles the record.
- `scripts/baseline/tests/test_capture_deployed_baseline.py` — the capture's pins; `load_capture` (line 53) imports the script by path.
- `charts/genieai-umbrella/templates/opea/{pii-service,okf-server,ragas-service}.yaml` — the three non-retrieval tiers; each declares its component label (`pii-service`, `okf-server`, `ragas-service`) and its env rows.
- `charts/genieai-umbrella/values.yaml` — the chart defaults; the OKF tiers' values live under `okf.*`, not `opea.*`.
- `charts/genieai-umbrella/Chart.lock` — the chart's dependencies; the release secret carries the same lock.
- `docs/baselines/v03-deployed-baseline-2026-11-18.md` — the record this story's gate extends.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/baseline/capture-deployed-baseline.py` — decode the deployed revision's Helm release secret and extract the rendered chart (templates, files, values, metadata, lock); never the manifest or the effective values.
- [x] `scripts/baseline/capture-deployed-baseline.py` — compare the local chart tree with the attested chart: per-file content (git blob identity), the chart version, the values leaves, and the lock's dependencies.
- [x] `scripts/baseline/capture-deployed-baseline.py` — resolve the commit of this repository that carries the attested chart; the source's kind, the attested chart's emptiness and the absence of a known commit are the three unresolved cases.
- [x] `scripts/baseline/capture-deployed-baseline.py` — extend `OPEA_WORKLOADS` with the three non-retrieval tiers (PII sidecar, OKF server, RAGAS judge) and their component labels; the capture's machinery is unchanged.
- [x] `scripts/baseline/capture-deployed-baseline.py` — render the chart identity in the record (attested version, source, commit, verdict) and feed every difference into the capture's existing exit gate.
- [x] `scripts/baseline/tests/test_capture_deployed_baseline.py` — pin the three unresolved cases and the identity verdict.

**Acceptance Criteria:**
- Given a deployed release whose chart this repository carries, when the capture runs, then the record states the attested chart version, the source it was rendered from, the commit of this repository that carries it, and whether the local chart tree is identical to it.
- Given a local chart source that differs from the attested chart, when the capture runs, then each difference is a row with a disposition.
- Given a comparison that cannot be established (a source that is not a GitRepository, an attested chart with no template, or a commit this checkout does not know), when the capture runs, then the row is UNRESOLVED and the capture exits 2.
- Given the three non-retrieval tiers are deployed, when the capture runs, then their environment is compared against the chart source like the retrieval tier's.

## Implementation Notes

- The pre-trim gate (`16ef9dc67`) read the GitRepository's artifact revision and compared the local tree with it. That revision is the source's **current** ref: measured on 2026-11-19, `HelmChart.status.observedSourceArtifactRevision` moved from `efa4db687` to `6bb54ffa` at 13:48 while the packaged artifact stayed at 2026-11-18T20:08:36Z. Flux updates it on every reconcile of the source, whatever the chart's reconcile strategy. It is not the commit the release was rendered from.
- The cluster object that does attest the rendered-from chart is the Helm **release secret** of the deployed revision (`sh.helm.release.v1.<release>.v<revision>` in `status.storageNamespace`): its `chart` holds the templates, files, values, metadata and lock the release was rendered with. Measured on the shared venue: the decoded chart's 77 template/file blobs are byte-identical to this checkout's `charts/genieai-umbrella` tree.
- The rendered chart's `values` are Helm's **coalesced** values: the chart's own values plus the dependency charts' defaults under the dependency names. Only the chart's own leaves are comparable; the dependency leaves are attested by the lock.
- Helm stores a release as base64(gzip(json)); the secret's `data.release` is base64 of that, so decoding is two base64 layers plus a gunzip.
- The commit this repository carries: the chart's content changes only where a commit touches `charts/genieai-umbrella`, so the candidates are those commits plus HEAD; each is compared with `git ls-tree`.
- The wave ruling (W-B2) puts #1998 and #1988 in one merge request with two `Closes`. Both are top-level goals of the capture, so they are recorded here as one story's two tasks rather than split; #1988 is a three-entry map extension and the machinery is untouched.
- The capture is read-only, so the shared venue is only read; the record it writes is a dated file under `docs/baselines/`.

## Spec Change Log

## Review Triage Log

| # | source | severity | finding | disposition |
|---|---|---|---|---|
| 1 | scoped validation (own turn, over `017e9f2a0..2d3fa2b1d`) | Important | the three OKF tiers' operator env map (`okf.pii.env`, `okf.server.env`, `okf.ragas.env`) was not compared — the comparison looked for the map under the workload's own chart section, so a knob the operator sets in those maps still drifted unnoticed | **fixed** — `WORKLOAD_ENV_MAPS` names the map's path per workload; the six retrieval tiers keep theirs |
| 2 | scoped validation | Important | an unreadable release payload raised out of the capture: no record was written, so a stale record could be read as current | **fixed** — an unreadable payload leaves the identity UNRESOLVED and the record says so |
| 3 | scoped validation | Minor | the coalesced dependency leaves were filtered by the source's lock alone — a dependency the attested chart carried and the source did not flooded the difference list | **fixed** — both locks' dependency names count |
| 4 | scoped validation | Minor | the vendored dependency directory was excluded by NAME at any depth | **fixed** — only the chart's own `charts` directory is excluded |
| 5 | global code-review round 2 | Important | `gzip.decompress` raises `zlib.error` on a garbled deflate stream — not `OSError`/`EOFError` — so it escaped the identity resolution and killed the capture | **fixed** — `zlib.error` is caught; pinned by a test |
| 6 | global code-review round 2 | Important | `git log -- <path>`'s default history simplification prunes the side-branch commits whose chart content no merge kept, so the candidate set missed commits this checkout carries | **fixed** — the history is walked with `--full-history` |
| 7 | global code-review round 2 | Important | the commit named was the checkout's tip whenever the tip carries the same chart content, and the docstring claimed it was the commit the release was rendered from | **fixed** — the commit is a LOCATOR (the wording says so in the code, the record and this spec) and the chart-touching commits are tried first |
| 8 | global code-review round 2 | Important | the release history's `chartVersion` was printed but never compared with the release secret's `metadata.version` (nor `chartName` with `metadata.name`) — the two attestations could disagree silently | **fixed** — they are compared, and a disagreement is a difference; pinned by a test |
| 9 | global code-review round 2 | Minor | the storage-namespace fallback ended in the install namespace; the venue's release secrets live in the HelmRelease's own namespace | **fixed** — the HelmRelease's namespace is tried before the install namespace |
| 10 | global code-review round 2 | Minor | `normalize()` maps `None` to `""`, so a null leaf and an empty one compared equal and the difference passed silently | **fixed** — `values_identical` tells null from empty; pinned by a test |
| 11 | global code-review round 2 | Minor | the file comparison runs against the working tree while the commit resolution runs against committed trees, so the two halves of the identity section could disagree | **fixed** — the record says which is which |
| 12 | global code-review round 2 | Minor | the Code Map's line references were stale | **fixed** — the Code Map names the current lines |
| 13 | scoped review of the corrections | Important | the fail-closed guard let a payload of the wrong SHAPE escape (AttributeError/TypeError out of `attested_chart`): the capture died with exit 3 and no record, so a stale record could be read as current | **fixed** — the whole extraction is guarded; pinned by a test over six malformed shapes |
| 14 | scoped review of the corrections | Minor | the two release-history cross-check rows shared the path `release history`, and their disposition asserted a false cause (the chart source) when the two cluster attestations disagree with each other | **fixed** — distinct paths, and a disposition that names the attestations |
| 15 | scoped review of the corrections | Minor | the Code Map cited `WORKLOAD_ENV_MAPS` at the wrong line | **fixed** |
| 16 | scoped review of the corrections | Minor | the bullet about the commit read as if the commit carried the WORKING TREE's content; it carries the attested content | **fixed** — the bullet says so |
| 17 | scoped review of the corrections | Minor | after the fallback reorder, `flux_namespace` shadowed the install namespace, making that fallback unreachable | **fixed** — the candidate namespaces are now tried in order, and each one is reachable |
| 18 | scoped review of the corrections | Minor | the non-root branch of the local file walk sorted a list that has no effect | **fixed** — the branch is gone |
| 19 | global code-review round 3 | Important | a release history with no DEPLOYED entry left the chart version empty, so the identity was resolved against a revision that never ran, the record printed empty values and the capture exited 0 | **fixed** — no deployed revision leaves the identity UNRESOLVED; pinned by a test |
| 20 | global code-review round 3 | Minor | the DIFFERENT verdict and the difference table's headers asserted the chart source was at fault, even when the only row was about the two attestations disagreeing | **fixed** — the verdict names the attestations when that is the cause, and the columns say which is which |
| 21 | global code-review round 3 | Minor | "Chart files compared" counted the attested files only, undercounting the files the comparison actually read | **fixed** — both counts are reported |
| 22 | global code-review round 3 | Minor | the new code read the chart source unguarded: a checkout without `Chart.lock` raised out of the identity and killed the capture (exit 3, no record) | **fixed** — an incomplete chart source leaves the identity UNRESOLVED; pinned by a test |
| 23 | global code-review round 3 | Minor | an untracked file under `charts/genieai-umbrella/` becomes a difference — "a false claim about the repository's chart source" | **not a defect** — helm packages every file of the chart directory, so an untracked file IS part of the chart source and the difference is real; the record already states that the comparison runs against the working tree |
| 24 | scoped review f=2 | Important | the chart-source guard read only `Chart.yaml` and `Chart.lock`, but `values.yaml` is read too — and `capture()` opened it BEFORE the identity was resolved, so a checkout without it died with exit 3 and no record | **fixed** — `values.yaml` is part of the guard, and the capture reads it defensively |
| 25 | scoped review f=2 | Important | the new test injected the SYMPTOM (`chart_version=""`) instead of the CONDITION, so `capture_release`'s wiring was never exercised | **fixed** — the test now runs a HelmRelease whose history has no deployed entry through `capture_release` |
| 26 | scoped review f=2 | Minor | the test stubbed `chart_source_complete`, pinning its consumption and not the predicate | **fixed** — the predicate is exercised on this checkout |
| 27 | scoped review f=2 | Minor | "Chart files compared" printed "0 attested, 0 in the chart source" when the identity was UNRESOLVED | **fixed** — the counts are printed only when they are established |
| 28 | scoped review f=2 | Minor | the record header still printed the never-deployed revision and empty values | **fixed** — the header says the history records no deployed revision, and the identity line says "not established" |
| 29 | scoped review f=2 | Minor | the DIFFERENT verdict named only the chart source as the cause, even when the attestations also disagreed | **fixed** — the verdict names every cause it found |
| 30 | scoped review f=3 | Important | the incompleteness guard covered only the identity, so a checkout without `values.yaml` produced a record whose configuration and model tables were computed against an EMPTY chart baseline and asserted differences that were never measured | **fixed** — the comparisons that need the chart source are skipped when it is incomplete, and the record says no comparison was made |
| 31 | scoped review f=3 | Minor | the "no deployed revision" reason was derived from an empty `chart_version` instead of the `history_deployed` flag, so the two signals the record prints could contradict each other | **fixed** — the flag drives the reason, and a deployed revision with no chart version has its own reason |
| 32 | scoped review f=3 | Minor | the commit LOCATOR prose was printed for an UNRESOLVED identity, referring to a commit line that was not printed | **fixed** — the prose belongs to the commit line |
| 33 | scoped review f=3 | Minor | "Chart the deployment runs: not established" was applied to every UNRESOLVED cause, discarding a chart version the release history really does establish | **fixed** — the line names the chart whenever the history establishes it |
| 34 | scoped review f=3 | Minor | the chart-source predicate's test exercised only the happy path, so dropping `values.yaml` from the guard would not redden the suite | **fixed** — the guard's coverage is pinned |
| 35 | scoped review f=4 | Important | the chart-source guard's test faked only `values.yaml`, so dropping `Chart.yaml` or `Chart.lock` from the guard left the suite green — the defect class rows 22 and 24 exist to prevent was unpinned | **fixed** — the guard is pinned per file |
| 36 | scoped review f=4 | Minor | the test named "no deployed revision" exercised the "deployed revision with no chart version" branch | **fixed** — the test is named for the branch it exercises |
| 37 | scoped review f=4 | Minor | `capture_models()` — the probe of the served model ids — sat inside the chart-source guard although it reads nothing from the source | **not a defect** — the model table compares the served ids with the chart source's defaults, so it IS a comparison against the source; when the source is incomplete the capture fails (exit 2) and the operator re-runs on a complete checkout. Probing without a table to put the answer in would be work the record cannot use |
| 38 | scoped review f=4 | Minor | the header still said "Source compared against: the chart source in this repository" while the banner said the comparisons were not made | **fixed** — the header says "not established" |
| 39 | scoped review f=4 | Minor | the banner said "no difference was measured, and none is reported below", while the image table still reports digest differences | **fixed** — the banner names what was not measured (configuration and models) and says the image digests and the topology are reported as usual |

## Design Notes

The identity has three axes and each is read from the object that attests it:

| Axis | Attested by | Read |
|---|---|---|
| the chart the deployment runs (version) | the HelmRelease's release history | the deployed revision's `chartVersion` |
| the chart the deployment runs (content) | the Helm release secret of the deployed revision | the decoded `chart` |
| the commit of this repository that carries it | this repository | the candidate commit whose tree matches the attested content |

The two cluster attestations must agree with each other: the release history's `chartVersion`/`chartName` are compared with the release secret's `metadata.version`/`metadata.name`, and a disagreement is a difference like any other.

The commit is a **locator**, not the commit the release was rendered from: the CONTENT is what the release was rendered with, and several commits carry the same chart content — a commit that never touched the chart carries it too. The record says so.

Comparing the local tree with the **source's current ref** is what story 1.2's gate did, and it is the defect this story exists to fix: a moving ref cannot say which chart was rendered.

The comparison is content, not version: the version is a single scalar that a chart bump moves; the content is what the release rendered with. A file that differs is a difference with a disposition, never a failure — the record's job is to state the truth, not to gate a deployment.

## Verification

**Commands:**
- `uv run --no-cache --with pytest --with pyyaml python -m pytest scripts/baseline/tests -q` -- expected: the capture's suite passes, including the three unresolved cases.
- `uv run --no-cache --with pyyaml python scripts/baseline/capture-deployed-baseline.py --namespace genieai --date 2026-11-19 --out /tmp/v03-identity.md` -- expected: the record states the attested chart, the source commit and the verdict; exit 0 when the local tree is identical to the attested chart.

**Manual checks (if no CLI):**
- `kubectl -n flux-system get helmrelease genieai -o yaml` -- the release history's `chartVersion` and the `storageNamespace` the release secret lives in.
- `kubectl -n flux-system get secret sh.helm.release.v1.genieai.v72 -o jsonpath='{.data.release}'` -- the attested chart the record's identity section is derived from.
