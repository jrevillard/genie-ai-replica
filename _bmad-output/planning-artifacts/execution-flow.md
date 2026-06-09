# Testing Framework — Execution Flow

> 9 epics, 43 stories across 3 waves. Stories within a wave can run in parallel across components.

## Wave 0 — Foundation (must complete first)

All tracks are independent and can run in parallel.

```
 ┌─ Epic 1: CI/CD ──────────┐  ┌─ Epic 7: MELT ────────┐  ┌─ Epic 6: Config ────┐
 │ 1.1 JUnit XML Reporting   │  │ 7.1 Trace Context      │  │ 6.1 Env Parser       │
 │ 1.2 CI Lint Stage         │  │ 7.2 Log Assertions     │  │ 6.2 HW Profile Val.  │
 │ 1.3 CI Test Stage         │  └────────────────────────┘  │ 6.3 Config Test Suite │
 └───────────────────────────┘                               └──────────────────────┘

 ┌─ Epic 2: Backend ────────┐  ┌─ Epic 4: OPEA ──────────┐
 │ 2.1 createApp() refactor  │  │ 4.1 pytest + fixtures   │     Fixture Consistency
 │ 2.2 Backend fixtures      │  └─────────────────────────┘     (2.2 ↔ 3.1 ↔ 4.1)
 └───────────────────────────┘
                                           ▼                     Backend API shape
                                  ┌─ Epic 3: Frontend ─────┐     = source of truth
                                  │ 3.1 Frontend fixtures   │
                                  └─────────────────────────┘
```

## Wave 1 — Core Tests (parallel across components)

After Wave 0 fixtures are done, each component team works independently.

```
 ┌─ Epic 2: Backend ────────────────────────────┐
 │ 2.3 Auth routes       2.5 Analytics/Cat.      │
 │ 2.4 Chat routes       2.6 Admin/Files         │
 │                       2.7 Service Layer        │
 │                       2.8 Middleware            │
 └────────────────────────────────────────────────┘

 ┌─ Epic 3: Frontend ──────┐  ┌─ Epic 4: OPEA ──────────────────────────┐
 │ 3.2 ChatBot/NavBar       │  │ 4.4 Core Types (prereq) ──┐             │
 │ 3.3 UserProfile/Admin    │  │ 4.2 Retriever              ├─┐           │
 │ 3.4 Vuex Store Modules   │  │ 4.3 Dataprep               │ │           │
 │ 3.5 HTTP Services        │  │ 4.5 Reranker    ◄──────────┘ │           │
 └──────────────────────────┘  │ 4.6 ChatQnA     ◄────────────┘           │
                               └────────────────────────────────────────────┘

 ┌─ Epic 5: Doc Repo ──────┐
 │ 5.1 Doc-repo fixtures    │
 │ 5.2 Upload/Download/Del  │
 │ 5.3 File Service Logic   │
 │ 5.4 Security Middleware   │
 └──────────────────────────┘
```

## Wave 2 — Cross-cutting & Advanced

Depends on Wave 1 test artifacts. E2E tests need backend + frontend + OPEA running.

```
 ┌─ Epic 1: CI/CD (continued) ──────────┐  ┌─ Epic 8: RAG Quality ──┐
 │ 1.4 Contract Test Stage               │  │ 8.1 RAG Test Bed        │
 │ 1.5 Config Validation Stage           │  │ 8.2 RAGAS Pipeline      │
 │ 1.6 MR Blocking & Scheduled Jobs      │  │ 8.3 Quality Report Gen. │
 │ 1.7 CI Caching & Path-Based Triggers  │  └─────────────────────────┘
 │ 1.8 E2E Playwright — Chatbot     ──┐  │
 │ 1.9 E2E Playwright — Doc Upload   ──┤  │  ┌─ Epic 9: AI Generation ┐
 └─────────────────────────────────────┘  │  │ 9.1 Scaffolding Gen.    │
                                          │  │ 9.2 Case Suggestion Eng.│
                                          │  └─────────────────────────┘
              E2E tests need running ─────┘
              backend + frontend + OPEA
```

## Dependency Chain (critical path)

```
2.1 createApp()
 │
 ├──► 2.2 Backend fixtures ──► 2.3-2.8 Backend tests ──► 1.4 CI Contract Stage
 │                                                     ──► 1.8-1.9 E2E Playwright
 │
 ├──► 3.1 Frontend fixtures ──► 3.2-3.5 Frontend tests
 │
 ├──► 4.1 OPEA fixtures ──► 4.4 Core Types ──► 4.5 Reranker
 │                                        ──► 4.6 ChatQnA
 │              ──► 8.1-8.3 RAG Quality
 │
 └──► 5.1 Doc-repo fixtures ──► 5.2-5.4 Doc-repo tests
```

## Parallelism Summary

| Wave | Parallel tracks | Scope |
|------|----------------|-------|
| 0 | 4 tracks | CI infra + MELT utils + Config validation + Component fixtures |
| 1 | 4 tracks | Backend tests + Frontend tests + OPEA tests + Doc-repo tests |
| 2 | 4 tracks | CI stages/E2E + RAG quality + AI generation |

**Bottleneck:** Story 2.1 (`createApp()` refactor) gates the entire Backend epic. Fixture stories (2.2, 3.1, 4.1, 5.1) gate all subsequent test writing within their respective epics.

**Independent epics:** Epic 6 (Config) and Epic 7 (MELT) have no cross-component dependencies and can start immediately.

**Team scaling:** 4 developers can work in parallel — one per component (backend, frontend, OPEA, doc-repo) — once Wave 0 fixtures are complete.
