---
title: 'Story 1.7 — Implement `read_source` and the authorization executor'
type: 'feature'
created: '2026-11-20'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 2
baseline_commit: '2cedec978dc0a9c918f0c6b147206d81757e5900'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-genie-ai-2026-11-16/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The contract (story 1.5) declares the authorization obligations — authorization before resolution, charset-guarded identifiers, legacy-corpus mapping, fail-closed failure — and the V04 map records (§6) that none of them is enforced yet: the executor is story 1.7's. Until it lands, nothing re-validates a resolved target against the caller's authorized set, and the legacy corpus is protected nowhere.

**Approach:** Implement the authorization executor inside `components/agent-service/capabilities/` — the port wrapper that enforces the caller context on every operation — plus the `read_source` adapters: legacy `file_id` resolved via doc-repo metadata + legacy-graph chunks, OKF concepts via okf-server's serving concept read (the exact `repo_id` + `concept_id` join). Search is enforced by the same executor at hit level, so the negative authorization matrix covers search results even though the search adapter itself is story 1.6. The retained-data product decision lands as a decision record with its save/revoke/restore acceptance scenario.

## Boundaries & Constraints

**Always:**
- The authorization check precedes every resolution: a target outside the authorized set is refused (`AuthorizationError`) without touching doc-repo, okf-server or ArangoDB — the refusal reveals nothing about the target's existence (no existence oracle).
- Every resolved target is re-validated against the request's authorized set after resolution too (V04 §6, defense in depth); a resolved target outside the set never reaches the caller.
- Legacy corpus mapping per AD-4: a legacy `file_id` is in scope iff the request's authorized set includes the legacy graph (`ARANGO_GRAPH_NAME`, default `GRAPH`). No per-user ACL exists or is invented.
- Fail-closed: an authorization-resolution failure produces an error or an insufficiency — never a wider corpus. The legacy fail-open window (V04 §2.2) is not replicated.
- Caller-supplied identifiers pass a charset guard before any use (the only guard in the tree today guards graph names in the OPEA retriever — the port owns its own).
- The four outcome codes keep their contract carriers: authorization failure and transient failure raised; insufficiency and degraded availability returned as result outcomes. Cancellation propagates untouched.
- Cross-user and cross-session identifier attempts are refused by the same per-request check: every call is authorized against the context handed in THAT request, so a permission change between turns invalidates retained-evidence reuse (FR-28).
- The retained-data decision is recorded with existing stores and authorities — no new governance layer (FR-28, V04 §4).
- All artefacts in English; ruff + pytest green on the component.

**Never:**
- No search adapter implementation (ArangoDB vector search, TEI) — story 1.6. The executor's search path is enforced generically over an injected inner port.
- No change to okf-server, document-repository, the BFF or the OPEA overlay.
- No new HTTP surface on agent-service, no Dockerfile COPY extension — nothing in the service imports the new modules yet (story 1.5's rule: the first importer carries the code into the image).
- No raw AQL built from caller-supplied strings (okf-011); bind variables only, and the collection name is built only from a charset-validated graph name.
- No new governance/persistence layer for retained data; no agent-side persistence.
- No OPEA import or service call anywhere in the new code (story 1.4's gate stays green).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| legacy read, authorized | `LegacyFileRef`, legacy graph in the authorized set | doc-repo metadata resolves; chunk content from the legacy graph's `{graph}_SOURCE`; `outcome=success`, provenance `{file_id}` | N/A |
| legacy read, unauthorized | `LegacyFileRef`, legacy graph NOT in the set | nothing resolved, nothing looked up | `AuthorizationError` before any resolution |
| legacy read, unknown file | authorized, doc-repo answers 404 | `outcome=insufficient_evidence`, no provenance, no content | N/A — answer type |
| OKF read, authorized | `OkfConceptRef`, repo in the authorized repos | serving concept read (exact join); `outcome=success`, provenance trio with `source:'okf-concept'` | N/A |
| OKF read, unauthorized repo | `OkfConceptRef`, repo_id outside `authorized_repos` | nothing resolved | `AuthorizationError` before any resolution |
| OKF read, unresolvable | authorized repo, concept absent (404) or live-fence refusal (403) | `outcome=insufficient_evidence`, no provenance — fail-closed, never a wider corpus | N/A |
| charset violation | identifier outside its guard (non-numeric `file_id`, metacharacter `repo_id`/`concept_id`, graph name) | the operation never runs | `AuthorizationError` — a refused identifier is refused before resolution |
| cross-user / cross-session attempt | a target outside THIS request's context (another user's repo, another session's evidence) | refused | `AuthorizationError` — same per-request check |
| permission change between turns | turn N authorized the target; turn N+1's context no longer does; retained evidence re-read | refused at turn N+1 | `AuthorizationError` (FR-28) |
| search, restricted-graph content | inner port returns hits whose provenance is outside the authorized set | every out-of-set hit is dropped before it surfaces; nothing left → `insufficient_evidence` — restricted-graph content is not searchable | N/A |
| search, empty authorized set | context with no authorized graphs | `insufficient_evidence` without calling the inner port | fail-closed |
| downstream unavailable | doc-repo / okf-server / ArangoDB unreachable or 5xx | no confident data | `TransientError` (retryable within budget) |
| content read partial | resolution succeeded, content could not be fully read | `outcome=degraded_availability`, provenance set, no content | N/A — degradation reported as degradation |
| result over budget | content exceeds `max_result_bytes` | truncated to budget, `truncated=true` | N/A |
| deadline expires | inner call exceeds `timeout_ms` | the operation stops without a partial result | `TransientError` |
| caller cancels | cancellation propagates into the operation | abandoned, propagated untouched | never reported as any outcome code |

</frozen-after-approval>

## Code Map

- `components/agent-service/capabilities/contract.py` -- the frozen contract: `DocumentCapabilityPort`, `CallerContext` (user id + authorized graphs + authorized repos + requested labels), `ReadSourceInput`/`ReadSourceResult`, `SourceRef` union, outcome taxonomy, `OperationBudget`, `OPERATION_SPECS`. Reuse — nothing here changes.
- `components/agent-service/capabilities/__init__.py` -- the package's public surface; extended with the executor + adapter exports.
- `components/gov-chat-backend/services/query-service.js:766` -- the legacy graph name authority: `process.env.ARANGO_GRAPH_NAME || 'GRAPH'`, prepended to the authorized set in hybrid posture, absent in okf_only. The executor reads the same env with the same default.
- `components/okf-server/services/authz-resolver-service.js:37` (`resolveGraphSet`) -- the authorized set is SERVING ∩ AUTHORIZED with the 6-1c restricted-repo fence applied (`filterServingByAcl`): the set the context carries is already post-fence, so the executor's membership check is complete enforcement for OKF targets.
- `components/okf-server/routes/okf-routes.js:43` -- `GET /api/okf/repos/:repo_id/concepts/:concept_id` (serving read): the exact-join concept read with the per-repo fence + publication gate inside the handler; foreign and fenced collapse to 404.
- `components/okf-server/controllers/repository-controller.js:1095` (`CONCEPT_CARD_FIELDS`) + `:1200` (`getConcept`) -- the citizen projection carries `repo_id, concept_id, graph_name, bundle_version, title, labels, summary, body, links` — `body` is the concept content.
- `components/okf-server/services/concept-meta-service.js:83` (`findConceptDoc`) -- the exact join is `firstExample({repo_id, concept_id})`; the `getConceptMetaFromAnyRepo` LIMIT-2 fallback is never acceptable for a read (ambiguity would widen). The adapter goes through the serving route, which uses the exact join.
- `components/okf-server/services/doc-repo-client.js:30` (`fetchDocMeta`) -- the doc-repo metadata GET precedent: `${url}/api/files/:id`, envelope unwrap `{file} | {data:{file}} | {data} | raw`.
- `components/document-repository/src/controllers/fileController.js:1250` (`getMetadata`) -- `{success, data}` envelope, 404 when absent; `fileController.js:60` -- `fileIdPattern = /^\d+$/` is the file-id shape.
- `components/okf-server/services/repository-service.js:235` -- `repo_id = uuidv4()`; `components/okf-server/services/parser-service.js:60` (`conceptIdFromPath`) -- concept ids are POSIX path slugs.
- `genie-ai-overlay/retriever/genieai_retriever_arangodb.py:320` -- `_GRAPH_NAME_PATTERN = ^[A-Za-z0-9_\-]+$` (#501 precedent: only ArangoDB-acceptable characters reach backticked AQL); `:1921-1975` -- the file_id enrichment + CAP-1 join read chunks with `ARANGO_FILE_ID_FIELD = "file_id"` from `{graph_name}_SOURCE`; `docs/baselines/v02-opea-query-path-contract.md` §4 -- chunk text rides the `text` field.
- `docs/baselines/v04-authorization-provenance-ownership-map.md` §2.3, §6 -- the story's obligation register: charset guard, authorization before resolution, legacy mapping, repo resolution inside the set — all "story 1.7" rows.
- `components/agent-service/requirements.txt` + `docs/dependencies/agent-service-dependency-evidence.json` + `tests/config-validator/__tests__/agent-service.test.js` -- the fully pinned tree and the V07a licence gate; unchanged by this story (the chunk adapter's `db_factory` is duck-typed, so `python-arango==8.3.3` — the overlay's pin, `genie-ai-overlay/retriever/requirements-cpu.txt:4228` — is adopted by the story that first imports it, story 1.6's search adapter).
- `docs/adr/` -- the ADR home (`0001-*`, `okf-001..044` series): the retained-data decision record lands here as the first `agentic-*` record.

## Tasks & Acceptance

**Execution:**
- [ ] `components/agent-service/capabilities/identifiers.py` -- the charset guards: legacy `file_id` digits (`^[0-9]+$`, doc-repo's own pattern), `repo_id`/`graph_name` ArangoDB-safe token (`^[A-Za-z0-9_\-]+$`, the #501 pattern), `concept_id` POSIX path slug (segments of `[A-Za-z0-9_\-]`, no `..`, bounded length). Each guard raises `AuthorizationError`.
- [ ] `components/agent-service/capabilities/adapters/__init__.py` + `adapters/docrepo.py` + `adapters/okf.py` + `adapters/chunks.py` -- the `read_source` adapters: doc-repo metadata GET (envelope unwrap, 404→unresolvable, auth/5xx/network→`TransientError`); okf-server serving concept GET (exact join server-side, 404/403→unresolvable fail-closed, auth/5xx/network→`TransientError`); legacy chunk read (bind-variable AQL over `{graph}_SOURCE` filtered by `file_id`, text field, bounded). All callers injected (fakes in tests); the caller's bearer is forwarded to the downstream services that validate their own callers (spine convention). No env/compose wiring this story — the image does not carry the modules yet; the first runtime importer (story 1.6) wires it.
- [ ] `components/agent-service/capabilities/executor.py` -- the authorization executor implementing `DocumentCapabilityPort`: per-request construction carrying the trusted context; pre-resolution charset + membership checks (`AuthorizationError`, no oracle); delegation to the adapters; post-resolution re-validation of every resolved provenance and every search hit; outcome mapping per the matrix; `asyncio.timeout` → `TransientError`; result-size truncation with `truncated=true`; `CancelledError` untouched; search over an injected inner port with the empty-set fail-closed short-circuit.
- [ ] `components/agent-service/tests/test_identifiers.py`, `tests/test_executor.py`, `tests/test_adapters_docrepo.py`, `tests/test_adapters_okf.py`, `tests/test_adapters_chunks.py` -- the acceptance evidence: every matrix row above covered; the negative authorization matrix table-driven; each guard proven red under its own mutation.
- [ ] `docs/adr/agentic-001-retained-answer-visibility.md` -- the retained-data product decision: earlier answers stay visible after a source is revoked (save/revoke/restore acceptance scenario), through existing stores (`conversations`/`messages`/`queries`) and existing authorities (the serving reads refuse revoked/fenced sources at re-resolution time) — no new governance layer.
- [ ] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- the story entry to `review`.

**Acceptance Criteria:**
- Given a legacy target and a context whose set includes the legacy graph, when `read_source` runs, then doc-repo resolves it and the legacy graph's chunks come back as content with `{file_id}` provenance; given the same target with the legacy graph absent from the set, then `AuthorizationError` is raised and doc-repo is never contacted.
- Given an OKF target whose repo is in the authorized repos, when `read_source` runs, then the concept is read through the serving route's exact join and returned with the provenance trio and `source:'okf-concept'`; given a repo outside the set, then `AuthorizationError` is raised before any resolution.
- Given any identifier outside its charset guard, when the operation is invoked, then it is refused before any resolution, and the refusal is an `AuthorizationError` — never a validation pass-through into AQL or a URL.
- Given an authorization-resolution failure at any point (unknown file, absent concept, live-fence refusal), when the operation completes, then the outcome is an error or an insufficiency — never content from a wider corpus.
- Given a target or a search hit whose identity is outside THIS request's context (another user's, another session's, or a pre-permission-change turn's), when it is presented, then it is refused — and a test proves a permission change between turns invalidates retained-evidence reuse (FR-28).
- Given a search whose inner port yields restricted-graph hits, when the executor returns, then no out-of-set hit has surfaced; restricted-graph content is not searchable.
- Given an unavailable doc-repo, okf-server or ArangoDB, when the operation runs, then the outcome is `TransientError` or a degraded result — never confident data.
- Given the retained-data decision record, when it is read, then it states the visibility decision, its save/revoke/restore acceptance scenario, and the existing stores and authorities it uses.
- Given the component tree, when `ruff check`, `ruff format --check` and `pytest` run, then all are green, and the story 1.4 OPEA-free gate stays green.

## Implementation Notes

- The executor is constructed per request (spine: "enforcement lives in the port's executor with per-request identity"): the trusted context travels in the constructor, so an operation can never run against a stale or swapped context, and retained-evidence reuse is invalidated by construction.
- Search enforcement needs no search adapter: the executor's search path enforces over the injected inner port (fakes in tests, story 1.6's real adapter later). This is what makes the AC's search-clause testable now without widening the story.
- A downstream 403 on an in-set target (a stale-context race) maps to unresolvable, fail-closed — never a permissive retry against a wider scope.
- **No new dependency this story.** The chunk adapter's `db_factory` is duck-typed (one `.execute(aql, bind_vars)` call), so `python-arango` is not imported anywhere yet: pinning it now would add an unused dependency and V07a rows for nothing. Story 1.6's search adapter — the first direct-ArangoDB consumer — adopts the overlay's `python-arango==8.3.3` pin with its own evidence rows.
- The guards were proven mutation-sensitive while developing: loosening the file-id charset, allowing dots in concept ids, or disabling the legacy membership check / the search hit filter each turned the suite red; restoring each mutation turned it green.
- **Empty-content semantics, settled by review round 1.** An OKF concept's empty body is a SUCCESS with `content=""` (the body is the source's true content — a frontmatter-only concept is legitimately empty). A legacy read whose chunk set is empty stays `degraded_availability` (the file resolved but its corpus text is unavailable — retryable). One validator-legal outcome per reality on each path; `_finalize_read`'s `empty_is_degradation` keyword carries the distinction.

## Spec Change Log

## Review Triage Log

Global code-review, round 1 (high effort, full diff `2cedec978..41e15a5a9`) — 2 important + 4 nit findings. Two were outside this story's diff (the reviewer read the whole umbrella-vs-main surface): the slim-variant build's missing `CACHE_BUST` + dead `$NOCACHE` expansion (`.gitlab-ci.yml`, extracted to #2025) and the `safe-frontmatter.js` header comment contradicting its own docstring (extracted to #2026). Four were in scope; every one verified real and fixed in `f049b8cf4`:

| Finding | Severity | Verdict | Disposition |
|---|---|---|---|
| A chunk row whose `text` is absent rides the AQL answer as None — `row.get("text", "")` yields None and the join crashed with a raw TypeError, escaping the contract's carriers | important | confirmed (reproduced) | **Fixed**: explicit coercion (`row.get("text") or ""`), test pinned |
| The chunk adapter's `self._db` attribute is written by the worker closure and read by nobody | nit | confirmed (test-only reader) | **Fixed**: attribute removed; the test captures the handle through its own factory |
| `_finalize_read` reported a resolved-but-empty source as `degraded_availability` — an OKF concept's empty body is its true content, not a failed fetch | nit | confirmed | **Fixed**: per-path semantics — legacy zero-chunks stays degraded (corpus text unavailable), OKF empty body is SUCCESS with `content=""`; tests pinned |
| A 200 with a non-object body raised `TransientError` whose message named the successful status as the failure cause | nit | confirmed | **Fixed**: distinct message naming the non-object payload; test pins the wording |

Global code-review, round 2 (post-quality pass `e517ba336`, high effort, diff `2cedec978..c11b198a0`) — 2 important + 4 nit, every one verified real and fixed in `7a01e963e`:

| Finding | Severity | Verdict | Disposition |
|---|---|---|---|
| The unauthorized-read tests built the executor with the WIDE context and called it with a narrow one — the context gate refused first, so the AD-4 legacy membership and OKF repo-membership checks never ran and deleting them left the suite green (the story's mutation-sensitivity claim was false for those checks) | important | confirmed | **Fixed**: five tests now carry the narrow context on both sides; both membership deletions mutation-proven red (4 failures) and green on restore |
| `RequestsTransport`'s `Session` was a class attribute — one process-wide cookie jar persisted one caller's cookies into another caller's GET (ambient credential bleed) | important | confirmed | **Fixed**: per-instance Session; pinned by `tests/test_adapters_http.py` |
| The chunk adapter required a materialized sequence; python-arango's lazy Cursor (the pin 1.6 adopts) supports neither slicing nor len — first production wiring would crash | nit | confirmed | **Fixed**: `list(db.execute(...))`; pinned by a lazy-iterator test |
| `asyncio.gather` orphaned the sibling leg on first failure (a dead ArangoDB query kept running) | nit | confirmed | **Fixed**: `asyncio.TaskGroup` cancels the sibling; single-exception groups unwrap to the contract's carrier; cancellations untouched |
| Deadline expiry leaves `to_thread` work running past the await | nit | confirmed (inherent to `to_thread`) | **Documented** on `_within_deadline`: the adapter's own per-call timeout is the real bound |
| The okf card payload was trusted beyond identity: a non-string body became `str()` confident garbage, an uncoercible `bundle_version` escaped as a raw pydantic error outside the carriers | nit | confirmed | **Fixed**: non-string body → TransientError; provenance construction wrapped, ValidationError → TransientError; both pinned |

The scoped fix review of `c11b198a0..7a01e963e` was **clean**: 0 critical, 0 important; the reviewer itself re-ran all six mutations red and 184 green on restore. Three minor pin-strength notes were declined with reasons: the ExceptionGroup handler's two unreachable carrier gaps (the adapters wrap every transport failure in `TransientError`, and a deadline arrives as cancellation, not a leg error — map them when this handler is next touched); the Session-isolation pin being structural rather than behavioral (the structural pin IS the regression mechanism — red under the exact revert); and the sibling-cancellation behavior riding on stdlib TaskGroup semantics with the carrier unwrap already pinned.

## Design Notes

**Why the OKF read goes through okf-server's serving route, not direct ArangoDB.** The exact join lives in `okf_concepts_meta` either way, but the serving route also applies the publication gate (a draft/retracted repo must not read) and the 6-1c restricted fence — reading ArangoDB directly would bypass both and widen access for a target whose meta row exists but whose repo is not serving. The executor's membership check remains the primary authority (the context is already post-fence); the route is defence in depth.

**Why the legacy content comes from chunks, not the file bytes.** The agent reasons over the corpus text; the corpus is the chunk collection (`{graph}_SOURCE.text`). doc-repo supplies the resolution (the metadata read is the only legacy surface that exists — V04 §2.3) and the chunks supply the content; the serve paths serve raw bytes to humans, not corpus text to a loop.

**Outcome mapping for a read.** Resolution failed → `insufficient_evidence` (no provenance, no content — the absent provenance is the signal). Resolution succeeded but content unavailable → `degraded_availability` (provenance set — the fact that the source resolved is true — content absent; nothing confident about the content is claimed). The carve-out (settled in review round 1): an OKF concept's **empty body is available content** — a SUCCESS with `content=""`, not a degradation; only the legacy path (zero chunks) maps empty to degraded. Both honor "degraded availability reports insufficiency/degradation — never confident data".

**Retained evidence and FR-28.** The executor re-validates every call against the context of THAT request; a turn-N+1 context without the target refuses a re-read of turn-N evidence. The visibility of the earlier answer itself (the persisted conversation text) is the ADR's product decision — it stays visible (existing stores, existing owners), while the citation re-resolution goes through the existing serving reads that refuse revoked/fenced sources at view time.

## Verification

**Commands:**
- `cd components/agent-service && ruff check . && ruff format --check .` -- expected: clean
- `cd components/agent-service && python -m pytest tests/ -q` -- expected: green, including the new suites
- `cd tests/config-validator && npm test` -- expected: green (the V07a evidence gate over the pinned trees, unchanged)
- `git diff origin/feat/agentic-foundations/prd --stat` -- expected: only the files in the task list
