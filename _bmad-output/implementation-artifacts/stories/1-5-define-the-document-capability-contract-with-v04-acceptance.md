---
title: 'Story 1.5 — Define the document capability contract (with V04 acceptance)'
type: 'feature'
created: '2026-11-19'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 2
baseline_commit: '5139149593247650c625754feae64a15e20660b6'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-genie-ai-2026-11-16/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 1 builds an OPEA-free document capability layer whose port (the contract) is the seam between the agent loop and every adapter (ArangoDB, TEI, okf-server, document-repository). The contract does not exist yet, and no contract can be written without knowing how authorization, provenance and ownership actually work today: the deployed legacy corpus carries no per-user ACL, `repo_id` has no server-side on-demand resolver, and the okf-server serving graph names are not derivable from the registry. V04 is the gate that decides whether AD-3's premise holds.

**Approach:** Ship a typed, versioned contract module (`components/agent-service/capabilities/`) that declares, per operation (`search_knowledge`, `read_source`), the input, result, provenance and error semantics, the per-operation timeout / result-size / cancellation semantics, and the compatibility rules — plus the V04 authorization/provenance/ownership map that states, explicitly, whether AD-3's premise is confirmed and which constraints the contract encodes.

## Boundaries & Constraints

**Always:**
- The contract is a **port** (AD-3): it declares semantics, it performs no I/O, imports no adapter and no `comps` package.
- Enforcement by construction: the port queries only the caller's authorized set; **model-generated arguments can never widen access** (FR-2). The operation inputs therefore carry no graph/repo/ACL field — the trusted caller context does.
- The **authorization check precedes every resolution**: a target outside the authorized set is refused without revealing whether it exists (no existence oracle). The HTTP mapping stays with ADR okf-006's layer.
- The error taxonomy distinguishes four codes that are **never confusable**: authorization failure, insufficient evidence, degraded availability, transient failure. Insufficient evidence and degraded availability are answer types (spine: "insufficient evidence is a successful answer type, not an error"), authorization failure and transient failure are raised errors.
- A **refused input** (one the contract refuses to validate) is not a fifth outcome: the operation never runs, and the refusal is a validation failure, not a capability outcome.
- Provenance follows the stable-id conventions only: legacy `file_id` (no source marker), OKF `concept_id` + `repo_id` + `bundle_version` with `source: 'okf-concept'`. `chunk_key` is **not** a citation id and never appears in provenance.
- V04 acceptance is **explicit**: the map states a verdict on AD-3 (confirmed or reopened) with file:line evidence. Silence is not acceptance.
- Numeric thresholds (timeout, size, top-k) are **not** invented here — PRD §8 places them post-baseline. The contract declares the *semantics* of each limit; the budget itself belongs to the orchestrator (AD-6).
- All artefacts (code, comments, docs) in English.

**Never:**
- No adapter implementation (no ArangoDB query, no TEI call, no okf-server client) — stories 1.6 and 1.7.
- No change to `okf-server`, `document-repository`, the BFF or the OPEA overlay: this story only *reads* them to establish the map.
- No CI gate work — story 1.4 owns the OPEA-free gate. This story only extends the existing `lint:agent-service` ruff path list so the new package is linted.
- No change to the deployed agent-service behaviour: the service ships dark and stays dark.
- No new runtime dependency: `pydantic` is already pinned and audited in `docs/dependencies/agent-service-dependency-evidence.json`.
- No preparation-status vocabulary beyond the values V02 records, and no preparation module — story 1.8 owns the module and the per-class failure behaviour.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| search_knowledge | authorized caller, prepared English query, requested label restrictions | result `outcome=success`, hits carry provenance (legacy `file_id` or OKF concept trio) | N/A |
| search_knowledge | the query's preparation status is not prepared (`passthrough_unknown_language`, `fallback_timeout`, `fallback_error`) | the contract refuses the input — the operation never runs | validation failure (422 in the service), not one of the four codes |
| search_knowledge | authorized caller, no admissible hit in the authorized set | result `outcome=insufficient_evidence`, hits empty | N/A — answer type, not an error |
| search_knowledge | a dependency is partially unavailable | result `outcome=degraded_availability`, partial hits, `truncated=true` | N/A — distinct code from insufficient evidence |
| search_knowledge | a dependency fails transiently | — | raised `TransientError` (`transient_failure`), retryable within the caller's budget |
| search_knowledge | the caller's authorized set cannot be resolved | — | raised `AuthorizationError` (`authorization_failure`), never a wider fallback |
| read_source | authorized legacy target (`file_id`) | result `outcome=success`, provenance `{file_id}`, content | N/A |
| read_source | authorized OKF target (`repo_id` + `concept_id`) | result `outcome=success`, provenance `{concept_id, repo_id, bundle_version, source:'okf-concept'}` | N/A |
| read_source | target outside the authorized set | — | raised `AuthorizationError` — the check precedes any resolution, so the refusal reveals nothing about the target; the HTTP mapping (403 vs 404) follows ADR okf-006, the port does not decide it |
| read_source | authorized target that does not resolve | result `outcome=insufficient_evidence`, no provenance | N/A — not an error; the absent provenance is what tells the caller the target is unresolvable |
| any operation | the caller cancels the operation | the operation abandons its work | cancellation propagates unchanged — it is never reported as any of the four codes |
| any operation | the result exceeds the caller's size budget | the result carries `truncated=true` | declared per operation, not silently dropped |
| any operation | the deadline expires | the operation stops without returning a partial result | raised `TransientError` (`transient_failure`) |

</frozen-after-approval>

## Code Map

- `components/agent-service/` — the Epic 1 service (story 1.3): flat package, `app.py` + `tracing.py` copied into the image, `pyproject.toml` with `[tool.setuptools] packages = []`, `requirements.txt` fully pinned (pydantic 2.14.4 already audited).
- `components/agent-service/tests/` — pytest suite (`tests/test_app.py`, `tests/test_tracing.py`); the CI lane runs `python -m pytest tests/ -q` from the component directory, so a sub-package is importable as `capabilities.*`.
- `_bmad-output/planning-artifacts/architecture/architecture-genie-ai-2026-11-16/ARCHITECTURE-SPINE.md` — AD-3 (contract placement, okf-server as the per-user read authority, enforcement by construction, no raw AQL, identifier resolution), AD-4 (registered toolset, executor enforcement, the legacy corpus has no per-user ACL), AD-10 (frozen behaviour, prepared English queries), the Consistency Conventions table (stable ids, trusted caller context, errors & insufficiency, capacity), and the structural seed (`capabilities/`).
- `components/okf-server/services/scope-authz-service.js` — `currentScopeMode` (`open` / `closed`, a garbage value degrades to `closed`), `deriveScopeAuthz`, `deriveReadAuthz` → `{isSuperAdmin, authorizedRepoIds, scopeMode, unrestricted}`.
- `components/okf-server/services/access-control-service.js` — `callerMayTraverseRepo` (restricted-repo fence, enforced in **both** scope modes), `filterServingByAcl`.
- `components/okf-server/services/authz-resolver-service.js` — `resolveGraphSet` → `{graph_names, per_graph_labels (all null — the G8 seam), domains, repos[{repo_id, name, domain, graph_name}], ttl_seconds}`: the **only** server-side `repo_id` → serving `graph_name` resolution, and it is per-caller.
- `components/okf-server/routes/okf-routes.js` — the `servingReads` sub-router (`requireScope('read', { allowScopelessWhenOpen: true })`): `GET /api/okf/retrieval-config`, `GET /api/okf/authz/graphs`, `GET /api/okf/repos/:repo_id/concepts/:concept_id`, `GET /api/okf/concepts/resolve-repo`. Everything else stays behind the strict scope gate.
- `components/okf-server/services/concept-meta-service.js` — `okf_concepts_meta`; `findConceptDoc` requires **both** `repo_id` and `concept_id` (the exact join); `getConceptMetaFromAnyRepo` returns `LIMIT 2` (ambiguous when several repos hold the same concept id).
- `components/gov-chat-backend/services/query-service.js` — the deployed trusted-caller-context assembly: the authorized graph set is resolved server-side (lines 744–790) and forwarded as structured fields; the catch at 806–824 fails closed for the carrier keys but falls back to the legacy posture.
- `components/gov-chat-backend/services/retrieval-config-client.js` — `resolveCached` (378–434), `legacyDefaultConfig` (126–137), `getAuthorizedGraphs` (570–600): the legacy default configuration is what a failed resolution degrades to.
- `components/document-repository/src/routes/fileRoutes.js` — `router.get('/:fileId', fileController.getMetadata)` (line 356) carries **no** authorization beyond the router-wide `authenticateToken`: the legacy corpus has no per-user ACL anywhere (no `user_id` / owner predicate in dataprep, retriever or chatqna).
- `genie-ai-overlay/retriever/genieai_retriever_arangodb.py` — `ARANGO_FILE_ID_FIELD = "file_id"` (193); the file-id enrichment (1921–1940), the CAP-1 join onto `okf_concepts_meta` (1941–1975), `_attach_provenance` (2345–2377) and `_merge_per_graph_results` (2380). The retriever's `_GRAPH_NAME_PATTERN` is the **only** identifier guard in the tree — and it guards graph names, not `repo_id` / `concept_id`.
- `genie-ai-overlay/chatqna/genieai_chatqna.py` — the provenance harvest (2954–2969): the OKF branch emits `concept_id` + `source: 'okf-concept'` (+ `repo_id` / `bundle_version` when resolved), the legacy branch emits the file id with **no** source marker (3645–3686).
- `docs/baselines/v02-opea-query-path-contract.md` §5.2 / §5.4 — the frozen `query_translation_status` vocabulary (`translated`, `passthrough_english`, `passthrough_unknown_language`, `fallback_timeout`, `fallback_error`) and the per-class preparation outcomes.
- `docs/adr/okf-006-403-vs-404-unauthorized.md` — 403 for unauthorized, 404 for absent, collapsed to 404 for high-sensitivity bundles: the port reports codes; the HTTP layer maps them.
- `docs/adr/okf-011-no-raw-aql-to-agents.md` — agents never get raw AQL; the server exposes parameterized, scope-checked operations.
- `docs/baselines/v02-opea-query-path-contract.md` + `v03-deployed-baseline-2026-11-18.md` — the record pattern this story's V04 map follows.
- `.gitlab-ci.yml` — the `lint:agent-service` job runs `ruff check app.py tracing.py capabilities/ tests/`; the `test:agent-service` job runs `python -m pytest tests/ -q` from the component directory.

## Tasks & Acceptance

**Execution:**
- [x] `components/agent-service/capabilities/contract.py` -- the typed, versioned contract: operation names, per-operation input / result / provenance / error types, the outcome taxonomy with its carrier / retry / fallback policy, the per-operation timeout / result-size / cancellation declarations, the caller context, and the compatibility rules -- FR-1..FR-5, AD-3 / AD-4 / AD-10
- [x] `components/agent-service/capabilities/__init__.py` -- the public re-export surface of the package
- [x] `components/agent-service/tests/test_contract.py` -- the acceptance evidence: every matrix row above is covered by a test that asserts the expected behaviour
- [x] `docs/baselines/v04-authorization-provenance-ownership-map.md` -- the V04 map: effective authorization, provenance and ownership, with the explicit AD-3 / AD-4 premise verdict and the constraints the contract encodes
- [x] `components/agent-service/pyproject.toml` -- declare the suite's `pythonpath`, so the component's modules resolve however pytest is started
- [x] `.gitlab-ci.yml` -- extend the `lint:agent-service` ruff path list to the new package (lint only; no new CI job)
- [x] `components/agent-service/requirements.txt` -- record `pydantic` as a direct dependency of the contract module (the pin itself is unchanged)
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- the story entry to `review`

**Acceptance Criteria:**
- Given the contract module, when it is imported, then it exposes exactly the two operations `search_knowledge` and `read_source`, each with a declared input type, result type, provenance type, outcome codes and its three limit declarations.
- Given the outcome taxonomy, when it is inspected, then the four codes are distinct, each has exactly one carrier, and no code is both raisable and reportable.
- Given a legacy provenance, when it is validated, then it carries `file_id` and no source marker; given an OKF provenance, then it carries `concept_id`, `repo_id`, `bundle_version` and `source: 'okf-concept'`; a mixed payload validates against neither.
- Given the operation inputs, when they are inspected, then no field can widen the authorized set (no graph, repo or ACL field exists on an input).
- Given a query whose preparation status is not prepared, when it is validated as a search input, then the contract refuses it, and the refusal is not one of the four outcome codes.
- Given the compatibility rules, when a consumer version is checked against a provider version, then the same major version is compatible, a different major version is not, and the outcome codes are declared stable.
- Given the V04 map, when it is read, then it states the AD-3 premise verdict explicitly, cites file:line evidence for every claim, and lists the constraints the contract encodes.
- Given the component's local suite, when it runs, then `ruff check`, `ruff format --check` and `pytest` are green on the new package.

## Implementation Notes

- The contract module is a package (`capabilities/`) with `contract.py` inside it, matching the spine's structural seed. The Dockerfile's `COPY` list is **not** extended: nothing in the service imports the contract yet, and the first importer (story 1.6) is the one that must carry it into the image. The pyproject's package list stays as it was — the component is not installed as a package (the image copies the runtime files it needs, the CI lane installs the requirements files), so declaring a package would promise an install path that does not exist. What the pyproject does gain is the pytest `pythonpath`, so the suite resolves the component's modules whether it is started as `pytest tests/` or as `python -m pytest tests/`.
- The `lint:agent-service` job's ruff path list is the only CI change: `ruff check app.py tracing.py capabilities/ tests/`. The job's `rules.changes` already matches `components/agent-service/**/*.py`, so the new package triggers the lane. No new job, and nothing belonging to story 1.4's OPEA-free gate is touched.
- `requirements.txt` changes by one comment line only: `pydantic` was already pinned and already audited in the dependency evidence, and it is now imported directly by the contract module.
- The taxonomy's carrier decides where a code is reported. Two codes are raised (`AuthorizationError`, `TransientError`), two are result fields. The refusal of an input the contract will not validate is deliberately **not** one of the codes — the operation never runs, so there is no outcome to report.
- The contract's own test caught a distinction worth keeping: a `repo_id` in a *target* is not a scope. The input models are pinned by their exact field sets, and the "no widening field" assertion lists the scope-shaped names a model argument may never carry.
- `bundle_version` is required but nullable, and `0` is a legitimate version — the deployed assembler rides a version of `0` and only omits an unresolved one (`genieai_chatqna.py:3664`).
- The V04 record's premise check is discharged with a scoping clarification, not a verdict that ignores one: AD-3's authority claim holds for the OKF repositories, and the legacy corpus — which has no per-user authority at all — has the port's executor as its authority. That executor is story 1.7's, and the record says so in a declared-versus-enforced table rather than implying enforcement that does not exist yet.

## Spec Change Log

## Review Triage Log

Global code-review, round 1 (high effort, full diff `513914959..3dc090af`) — 6 important + 6 nit findings, each reproduced by the reviewer against pydantic 2.14.4. Every one was fixed in the same commit; none was extracted, and none was refuted.

| Finding | Verdict | Disposition |
|---|---|---|
| `AuthorizedRepo` may name a graph outside `authorized_graph_names`, and a `repo_id` may repeat | high — a widening path the model cannot express as invalid | **Fixed**: a `CallerContext` validator requires every authorized repository to name a graph of the authorized set and every repository id to appear once. |
| The limit vocabularies share values with the outcome vocabularies | high — `LimitBreach.TRANSIENT_FAILURE == OutcomeCode.TRANSIENT_FAILURE` | **Fixed**: the limit values are prefixed (`breach_…`, `scope_…`), and a test asserts that no two vocabularies share a value. |
| The result validators enforce only the success direction | high — an insufficiency could carry hits, or a provenance and a body | **Fixed**: an insufficiency carries no hit and no source. |
| The compatibility rules promise a new outcome code is additive, while the result type is a closed literal | high — a "compatible" provider's payload fails validation | **Fixed**: a new outcome code is declared breaking; the outcome vocabulary is closed. |
| The limit declarations are shared mutable singletons, and the spec is unhashable | high — one operation's semantics could be changed by editing the other's | **Fixed**: the declarations are frozen and each operation declares its own; the spec is hashable again. |
| `pyproject.toml` declares a package the editable install cannot import | high — the story's own claim did not hold | **Fixed**: the package declaration is withdrawn (the component is not pip-installed) and the claim is corrected. |
| `CapabilityError.code` has no class-level value | low — `type(exc).code` raised | **Fixed**: each error class carries its code on the class. |
| `_parse_version` accepted signs and whitespace | low — `is_compatible('+1.0','1.0')` was true | **Fixed**: the version must match `major.minor` digits. |
| The result's preparation status accepted statuses the input refuses | low — a result could report a preparation failure that must never have run | **Fixed**: the result's status is a prepared one. |
| The docstrings promised a narrowing channel the types do not provide | low — an implementer could add a label field the test forbids | **Fixed**: the wording states that the narrowing is context-only. |
| The V04 record's claim about the file record's owner field was inaccurate | low — the record has a client-controlled `author` string | **Fixed**: the record names the field and states that it is free text, not an identity. |
| The suite only resolved the package under `python -m pytest` | low — a plain `pytest` failed to collect | **Fixed**: the component's pyproject declares `pythonpath = ["."]`. |
| **Found while writing this record**: the document repository *does* fence `okf_restricted` files on the four serve paths, and the record said it authorized nothing | high — the record overstated the gap | **Fixed**: §2.3 now separates the two corpora — no per-user ACL on the legacy corpus, a stamped per-repository fence on the OKF-imported files' serve paths, and the metadata read outside that fence. |

The scoped fix-review of that mutation (`3dc090af..d05a123cd`) was **not clean**: nine items were outstanding, two of them new defects the mutation itself had introduced — the egg-info directory the global review's editable-install experiment left behind, swept into the commit, and the compatibility rules still calling a new optional field *additive* while every model refuses the fields it does not know. Both are fixed, along with the record's still-unqualified verdict sentence, its two off-by-one serve-path citations, its `author` citation pointing at the formatter the metadata read does not use, the story's task list still promising the withdrawn package declaration, the pyproject's stale editable-install claim, the Unicode-aware version pattern and the docstring's claim about narrowing. The prepared statuses still had two declarations after `d05a123cd` — the second one, derived from the literal, survived until `f49478f57` removed it. The second fix-review (`d05a123cd..0119e3eb1`) was **not clean** either: the compatibility rules' prose still contradicted their own data, the prepared-status test could not fail for the defect it named, the forbid-extra invariant the breaking clause rests on was unpinned, and the pyproject's header claimed the image copies the sources. All are fixed in `f49478f57`.

The operator lifted the park on 2026-11-20, and the scoped coverage of the last correction (`f49478f57..b4dc9b00a`) opened a new chain. Commit `b4dc9b00a` closed the story's false claim about the image and pinned the closed vocabularies — with the new guard proven red under every mutation it names — but the coverage over it found two gaps. The compatibility rules' prose still named **three** closed vocabularies while the data declared **four**, the same prose-versus-data shape the previous round had closed; and the `ResultOutcome` literal, the one the breaking clause actually names, was unpinned, so adding a *raised* code to it left the suite green and would have let a result carry a code the policy table reports as an exception. Both are fixed, and all ten breaking clauses are pinned now — the last coverage pass found the pinning claim true only of the five vocabulary clauses and the field clauses, and pinned the four semantic-change clauses the same way. Two record-level corrections travel with it: the commit message of `b4dc9b00a` attributed the prepared-status duplicate's removal to itself when `f49478f57` had already removed it, and this paragraph's ordinal commit references are now the commits' SHAs.

**The new chain is clean** (`8825632dd` fixed the two gaps the first coverage found, `bb48bb5dc` fixed the two record-level items its coverage found — the pinning claim held only of six of the ten clauses, and the paragraph credited the coverage instead of `b4dc9b00a` as the closer — and the coverage of *that* (`8825632dd..bb48bb5dc`) verified every clause byte-exact and every mutation red at the head while green at the parent). The quality pass then ran over the whole branch diff: the four `/simplify` angles returned reuse-clean and efficiency-clean, eight simplification findings and four altitude findings; four were applied in `58b6e14f7` (the raised-error classes lost their pure-forwarding `__init__` overrides — each subclass now declares its `code` once and the base takes message + operation only; the two `OPERATION_SPECS` entries are built by one `_spec` helper that still gives each operation its own limit-declaration instances; a `an_okf_provenance()` test helper replaced four identical constructions; pyproject states its packaging rationale once), and the rest were declined with reasons — the star-import barrel would fail the selected ruff `F403`, `OutcomePolicy.code` and the two constant compatibility flags are declarative data by the same convention as `OperationSpec.name`, the repeated invariants are doc layering, the CI lane's path enumeration is repo convention (switching it to a bare `ruff check .` is a repo-wide cleanup owed when story 1.7 adds modules), the V04 record's reconsideration triggers already name its re-checkable facts, and the limit-declaration identity pin is the settled per-operation-facts stance. One intentional surface change rides with the refactor: `CapabilityError("msg")` now constructs with its class-attribute code and the base no longer accepts a `code=` kwarg — no in-repo caller passed one. The `/test-audit` sweep confirmed the settled pins and found two weak candidates and two coverage gaps, fixed in `a98f5ce98`: the SUCCESS-read-without-content refusal is now mutation-guarded, the spec hashability pin gained a `FrozenInstanceError` attempt no `eq` flag escapes, and `OperationSpec.version` is pinned to the contract version; the audit's echo-assert candidates were declined as the acceptance halves of boundary pairs. The post-quality coverage (`bb48bb5dc..a98f5ce98`) verified the refactor behavior-preserving, the three mutation guards red under their own mutations, and the commit messages honest — **clean**.


## Design Notes

**The outcome taxonomy (FR-1 + the spine's "errors & insufficiency" convention).** One enum carries the five codes; a policy table gives each one a carrier, a retry flag and a fallback rule.

| Code | Carrier | Retryable | Fallback |
|---|---|---|---|
| `success` | result | no | — |
| `authorization_failure` | exception (`AuthorizationError`) | no | never — a failure never widens access |
| `insufficient_evidence` | result | no | never — an answer type, not an error |
| `degraded_availability` | result | yes, within the budget | within the authorized set only |
| `transient_failure` | exception (`TransientError`) | yes, within the budget | within the authorized set only |

`cancelled` is deliberately **not** a code: a cancelled operation is neither a failure nor an insufficiency. It is the breach outcome of the cancellation limit, and the taxonomy cannot report it by accident.

**Provenance is a union, not a bag of optional fields.** `LegacyFileProvenance` (`file_id`, no source marker) and `OkfConceptProvenance` (`concept_id`, `repo_id`, `bundle_version`, `source: 'okf-concept'`) both forbid extra fields, so a mixed payload validates against neither and a legacy hit can never grow an OKF identity. `bundle_version` is required but nullable: the deployed CAP-1 join tolerates its absence (V02 §4.7), so the producer must state it explicitly — an int when the join resolved it, `null` when it did not — and the port never fabricates one.

**The caller context carries the repo → graph mapping.** V04 found that the only server-side `repo_id` → serving `graph_name` resolution is the per-caller `repos[]` of `GET /api/okf/authz/graphs`; there is no on-demand resolver, and the registry's `OKF_{repo_id}` anchor is not the serving name (`OKF_{slug}_v{n}`). The contract therefore requires the trusted context to carry `authorized_repos` next to `authorized_graph_names`, so that a `repo_id` is resolved **inside the authorized set** and never by an unguarded lookup (AD-3: identifiers are charset-validated or resolved server-side). The context also carries the request's `requested_labels` (the requested narrowing): those are caller-side and context-only — a model argument contributes the query and nothing else, so it can neither widen the search nor change what the request asked for. The mapping itself is bounded too: every authorized repository must name a graph of the authorized set, so the resolution cannot widen the scope it resolves into.

**Declared versus enforced.** A contract can *declare* an obligation; only an executor can enforce it. The port's call shape (a `Protocol`) and the budget it runs under are declared here; the re-validation of every target against the authorized set is story 1.7's, and the V04 map says which obligations are enforced today and which are only declared — that difference is the risk register the next two stories inherit.

**The port's call shape is part of the contract.** The two operations are declared as one `Protocol` with the caller's context, the operation input and the operation budget — so story 1.6 and story 1.7 implement one interface instead of two invented signatures. The budget carries no values (PRD §8 places the thresholds post-baseline): it carries the shape the orchestrator fills in (AD-6).

**The prepared query is part of the input contract.** AD-10 requires the port's input to be a prepared (English) query, and V02 §5.2 records the frozen `query_translation_status` vocabulary. The contract types the query as a prepared query carrying its status, refuses the statuses that are not prepared, and echoes the status in the search result (the spine: the port carries the preparation status in results). Story 1.8 owns the preparation module and the per-class failure behaviour; the contract only states what a valid input is.

**Limits are declared, not valued.** Each operation declares what a limit means and what the caller observes when it binds (`timeout` → the operation stops without a partial result; `result_size` → the result carries `truncated=true`; `cancellation` → the operation abandons its work). The numbers belong to the caller's budget (AD-6) and to PRD §8's post-baseline thresholds, so the contract supplies the semantics, not the values.

**V04 verdict shape.** The map answers one question — does AD-3's premise hold — and answers it with evidence. Either outcome is acceptable; a silent outcome is not. A confirmed premise is recorded with the constraints the contract encodes; a divergence is recorded with the exact premise that fails, and reopens AD-3 (and AD-4 with it).

## Verification

**Commands:**
- `cd components/agent-service && ruff check . && ruff format --check .` -- expected: clean (the component's ruff config: py311, 120 columns, double quotes)
- `cd components/agent-service && python -m pytest tests/ -q` -- expected: green, including the new `tests/test_contract.py`
- `cd components/agent-service && python -c "from capabilities import contract; print(contract.CONTRACT_VERSION)"` -- expected: the contract version prints and the package imports from the component directory (the way the CI test lane runs)
