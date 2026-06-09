# Epic 4 Retrospective: OPEA Microservice Test Suite

**Date:** 2026-05-18
**Epic:** Epic 4 — OPEA Microservice Test Suite
**Status:** Complete (6/6 stories done)
**Participants:** Amelia (Developer), Alice (Product Owner), Charlie (Senior Dev), Dana (QA Engineer), Elena (Junior Dev), Murat (Test Architect)

---

## Epic Summary

| Metric | Value |
|--------|-------|
| Stories completed | 6/6 (100%) |
| Total tests written | 275 |
| Test progression | 28 → 104 → 140 → 194 → 224 → 275 |
| Starting point | Zero test infrastructure (5,018 lines Python untested) |
| Technical debt items discovered | ~15 (5 critical) |
| Production incidents | 0 |
| Linting compliance | Ruff clean across all stories |

### Stories Delivered

| Story | Description | Tests Added | Cumulative |
|-------|-------------|-------------|------------|
| 4.1 | Configure pytest and create shared fixtures | 28 | 28 |
| 4.2 | Test retriever hybrid search logic | 76 | 104 |
| 4.3 | Test dataprep extraction pipeline | 36 | 140 |
| 4.4 | Test core type definitions and API protocols | 54 | 194 |
| 4.5 | Test reranker score validation and top-K constraints | 30 | 224 |
| 4.6 | Test ChatQnA orchestrator interface | 51 | 275 |

---

## Successes

### 1. sys.modules Pre-population Pattern (Story 4.1)

The foundational breakthrough that enabled the entire epic. OPEA `comps` is vendored at Docker build time and cannot be pip-installed. The `sys.modules.setdefault()` pattern in conftest.py made it possible to mock all OPEA dependencies before pytest collection. Without this, no OPEA test could run.

### 2. Factory Pattern with Overrides

Driven by Murat's review in Story 4.1, the factory pattern (`create_<component>(**overrides)`) became the standard across all stories. Each fixture returns an inner factory function allowing keyword overrides while maintaining consistent default shapes. This made subsequent stories significantly smoother.

### 3. Progressive Fixture Accumulation

conftest.py grew organically across stories, each adding only the sys.modules entries needed for its scope. This avoided a massive upfront mock setup while ensuring each story's mocks were battle-tested by subsequent stories.

### 4. Review Quality

Code reviews consistently strengthened assertions (from `.assert_called_once()` to verifying call arguments) and added edge case tests (boundary conditions, error paths, negative validation). The review-then-fix cycle was efficient — every story passed review after one round of corrections.

### 5. Comprehensive Dev Notes

Each story documented: import-time dependencies, `__init__` bypass rationale, mock setup requirements, production code issues discovered. This creates a survival guide for anyone maintaining or extending these tests.

### 6. Consistent Code Quality

All 275 tests pass Ruff linting and formatting (target py310, line-length 120). ITU copyright headers present on all files. No regressions across stories.

---

## Challenges

### 1. MagicMock model_dump() Returns MagicMock, Not dict

**Affected stories:** 4.5, 4.6
**Pattern:** `mock.model_dump(exclude_none=True)` returns `MagicMock()`, not `{}`. Every mock input must explicitly configure `model_dump = MagicMock(return_value=real_dict)`.
**Impact:** Silent test failures when forgotten — code using `.get()` on the result gets `None` instead of expected values.
**Mitigation:** Document as team agreement; add to review checklist.

### 2. isinstance() Always False with Mocked Types

**Affected stories:** 4.5, 4.6
**Pattern:** `isinstance(mock_input, MockedType)` returns `False` when `MockedType` is a MagicMock from conftest.
**Workarounds used:**
- Set attributes for both branches (Story 4.5)
- Patch with real enum via `patch()` (Story 4.6)
- Create real types via autouse fixtures (Story 4.5)
**Impact:** Cannot test type-based routing in the normal way; requires creative workarounds.

### 3. Module-Level Constants Evaluated at Import Time

**Affected stories:** 4.4, 4.6
**Pattern:** Constants like `IS_TRANSLATEGEMMA`, `MEGA_SERVICE_PORT`, `CHATQNA_SYSTEM_PROMPT` are evaluated once at import. Cannot change via `os.environ` in individual tests.
**Workaround:** Use `patch("module.CONSTANT", value)` to override in specific tests.
**Impact:** Tests are coupled to module paths; refactoring breaks tests.

### 4. OPEA Vendored Dependencies Architecture

**Systemic issue:** OPEA `comps` library is vendored at Docker build time, not pip-installable. All imports must be mocked via `sys.modules`. This is an architectural constraint we don't control.
**Impact:** Mocks may drift from real OPEA API; cannot run integration tests without Docker.

### 5. Production Code Issues Discovered Through Testing

Writing tests revealed ~15 issues in production code (see Technical Debt section). While discovering these is valuable, addressing them is out of scope for the testing epic and adds to the backlog.

---

## Technical Debt Discovered

### Critical (Can cause production crashes)

| ID | Location | Issue | Story |
|----|----------|-------|-------|
| TD-1 | ChatQnA align_outputs (L575, L587) | `assert` statements in production code — raise AssertionError in optimized mode | 4.6 |
| TD-2 | ChatQnA (L1684) | `file_metadata["labels"]` unguarded dict access — KeyError on unexpected data | 4.6 |
| TD-3 | ChatQnA (L604) | `runtime_graph.downstream(cur_node)[0]` — IndexError on empty list | 4.6 |
| TD-4 | ChatQnA (L550) | `assert isinstance(data, list)` in EMBEDDING output — production crash | 4.6 |
| TD-5 | Reranker | No try/except around aiohttp call to TEI — unhandled network errors | 4.5 |

### Medium (Pre-existing, not introduced by testing)

| ID | Location | Issue | Story |
|----|----------|-------|-------|
| TD-6 | Retriever | Unreachable graph validation branch in source code | 4.2 |
| TD-7 | Dataprep | Race condition in ArangoGraph initialization during concurrent batches | 4.3 |
| TD-8 | Dataprep | File lock `fileno()` edge case | 4.3 |
| TD-9 | ChatQnA | Bare `dict[key]` access in align_inputs/align_outputs — KeyError on unexpected data | 4.6 |
| TD-10 | Reranker | Index out-of-bounds in `retrieved_docs` lookup — no bounds check on TEI-returned indices | 4.5 |

### Low (Nice-to-have improvements)

| ID | Location | Issue | Story |
|----|----------|-------|-------|
| TD-11 | Dataprep | Concurrent batch failure scenarios (complex, out of scope) | 4.3 |
| TD-12 | Dataprep | Orphan deletion with circular references (edge case) | 4.3 |
| TD-13 | Reranker | KneeLocator single-doc/flat-score edge cases | 4.5 |
| TD-14 | ChatQnA | 3/5 `add_remote_service*` variants untested | 4.6 |
| TD-15 | Core | RetrievalRequestArangoDB serialization requires real OPEA deps in Docker | 4.4 |

---

## Key Insights

1. **Test-first reveals production fragility:** Writing tests against existing code surfaced 15 production issues. This is one of the core values of the testing epic — systematic test writing as a code audit.

2. **Mock architecture is the foundation:** The conftest.py sys.modules strategy was the single most important technical decision. Investing a full story (4.1) in test infrastructure before writing functional tests paid dividends across all subsequent stories.

3. **OPEA's vendored architecture creates test debt:** Because `comps` is not pip-installable, all tests mock OPEA at the module level. This means tests verify behavior against our understanding of OPEA's API, not against the real API. Integration tests in Docker are needed for full confidence.

4. **Review discipline improves quality systematically:** Murat's consistent focus on stronger assertions and edge case coverage raised the bar for every story. The pattern of "review → strengthen → confirm" should be maintained.

5. **Dev notes are force multipliers:** The detailed documentation of mock strategies, bypass patterns, and import chains means future developers can extend tests without rediscovering all the gotchas.

---

## Next Epic Preview: Epic 5 — Document Repository Test Suite

### Dependencies on Epic 4

- **Conceptual:** Mock factory pattern, `__init__` bypass strategy, fixture organization
- **Response shapes:** ArangoDB mock responses must be consistent with backend tests (Epic 2) and OPEA tests (Epic 4)
- **Tooling:** Different stack — Jest/CommonJS (not pytest), Supertest for HTTP tests

### Preparation Needed

| Priority | Task | Owner | Notes |
|----------|------|-------|-------|
| Critical | Verify mock response shape consistency with Epic 2 backend fixtures | Dev | Shapes are cross-component contract |
| Critical | Check compatibility with existing `__mocks__/shared-lib.js` | Dev | Existing mocks must continue working |
| Parallel | Create test fixture files (EICAR, PDF, txt) during Story 5.1 | Dev | Needed for ClamAV and upload tests |
| Nice-to-have | Port factory pattern to Jest/CommonJS conventions | Dev | Adapt, don't copy |

### Technical Prerequisites

- Document-repository already has `__tests__/` directory with existing mocks
- ClamAV EICAR test signature must be created as fixture file
- Supertest configured for HTTP endpoint testing
- CommonJS `require()` syntax required (NFR21)

### Risks

- **ClamAV mocking complexity:** Must simulate both clean and infected scan results
- **File upload multipart testing:** Supertest + multer mocking can be tricky
- **Cross-component shapes:** If backend and doc-repo mock shapes diverge, integration tests will fail

---

## Action Items

### Process Improvements

1. **Create OPEA Mock Setup Guide**
   - Owner: Amelia
   - Deliverable: `genie-ai-overlay/tests/README.md` documenting sys.modules pattern, `__new__()` bypass, model_dump() fix
   - Success criteria: New developer can set up OPEA tests using only this guide

2. **Standardize Review Assertion Checklist**
   - Owner: Murat
   - Deliverable: Updated review checklist requiring: argument verification, edge case tests, boundary conditions
   - Success criteria: Every review explicitly checks assertion strength

### Technical Debt

3. **Fix production `assert` statements in ChatQnA**
   - Owner: TBD
   - Priority: High (must address before Sprint 24 ChatQnA refactoring)
   - Scope: Lines 550, 575, 587 in genieai_chatqna.py

4. **Add guard clauses for unguarded dict/list access in ChatQnA**
   - Owner: TBD
   - Priority: High
   - Scope: `file_metadata["labels"]`, `downstream()[0]`, bare `dict[key]` in align_inputs/align_outputs

5. **Add error handling for aiohttp TEI call in reranker**
   - Owner: TBD
   - Priority: Medium
   - Scope: genieai_reranker.py aiohttp call

### Documentation

6. **Document mock response shapes as cross-component contract**
   - Owner: Amelia
   - Deliverable: Section in tests/conftest.py or standalone document
   - Success criteria: Epic 5 fixtures reference same shapes

### Team Agreements

- Always configure `model_dump()` explicitly on Pydantic mocks
- Always test both branches of `isinstance()` when the type is mocked
- Document every OPEA workaround in story dev notes
- Verify call arguments in assertions, not just call occurrence
- Add boundary tests (exact threshold, empty input, single element)

---

## Readiness Assessment

| Dimension | Status | Notes |
|-----------|--------|-------|
| Testing & Quality | ✅ Complete | 275 tests passing, Ruff clean |
| Deployment | ✅ N/A | Unit tests only, no deployment concerns |
| Stakeholder Acceptance | ✅ Complete | FR17–FR21, FR36 validated per PRD |
| Technical Health | ⚠️ Debt documented | 5 critical items in production code, tracked for remediation |
| Unresolved Blockers | ✅ None | All stories done, no carry-over |

**Epic 4 is fully complete and ready for Epic 5.**

---

## Commitments Summary

- **Action Items:** 6 (2 process, 3 technical debt, 1 documentation)
- **Team Agreements:** 5 coding/review standards adopted
- **Critical Path Items:** 2 (mock shape verification, shared-lib compatibility check)
- **Technical Debt Tracked:** 15 items (5 critical, 5 medium, 5 low)

---

*Retrospective conducted autonomously on 2026-05-18. First retrospective of the testing-framework initiative.*
