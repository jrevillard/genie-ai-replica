---
baseline_commit: d3b8a730a
---

# Story 1.6: Presidio deployment + config plumbing

Status: review

## Story

As a deployment operator,
I want Presidio deployed as a service (analyzer + anonymizer) with the HTTP redactor implemented and every var plumbed through compose, `env`, and Ansible's `env.j2`,
so that setting `PII_REDACTOR_IMPL=http://presidio-analyzer:3000` upgrades PII protection to NER-grade without touching code (NFR5, NFR6, D11, D13).

## Current State (verified on `feat/sst` 2026-09-01, post-1-1 `d3b8a730a`)

- **The HTTP redactor is a stub that raises** (`pii_redactor.py:302-306`): `create_pii_redactor("http://...")` → `PIIRedactionError("HTTP PII redactor not yet implemented")`. The in-process `PresidioPIIRedactor` exists (imports presidio packages into the caller — NOT the service shape the epic pins).
- **No presidio services in docker-compose.yaml** (sprint-status evidence stands). The pattern to mirror: the `searxng` block (`docker-compose.yaml:588-617`) — fluent logging anchor, internal-only, healthcheck, `genieai == true` placement, restart policy.
- **E7 gap confirmed**: `deploy/ansible/templates/env.j2` has **zero** SST vars — not even 2-1's `SEARXNG_URL`. env.j2 ends at SECTION 21; sections use `{% if var is defined ... %}{{ var }}` conditioning over Ansible group_vars.
- **`env` template already has SECTION 15 (WEB SEARCH / SERVER-SIDE TOOLS)** — created by story 2-4 with the three web-search vars. The epic's "new SECTION 15" predates that: extend the existing section with the PII vars instead of colliding.
- **config-validator**: `tests/config-validator/` parses `env` + compose and cross-references coverage, with an allowlist for app-code-only vars (`__tests__/config-validation.test.js`). `chatqna`'s compose env block does NOT pass any PII vars today.
- **Pinned image tags (researched 2026-09-01, MCR registry API)**: `mcr.microsoft.com/presidio-analyzer:2.2.362` and `mcr.microsoft.com/presidio-anonymizer:2.2.362` — MCR remains actively maintained (the Docker Hub page's "use GHCR" note refers to a different distribution; MCR's own tags list shows 2.2.362 as newest numeric, pushes through 2026-07). Analyzer listens on 3000, anonymizer on 3001; analyzer downloads a spaCy `en_core_web_sm` model on first start (slow first boot — healthcheck `start_period` must account for it).

## Acceptance Criteria

1. **HttpPIIRedactor implemented** in `pii_redactor.py`: `analyze` (POST `{analyzer}/analyze` with `{text, language:"en"}`) → `anonymize` (POST `{anonymizer}/anonymize` with the analyzer's entities) → returns `RedactionResult`; URLs from `PRESIDIO_ANALYZER_URL`/`PRESIDIO_ANONYMIZER_URL` env (the `PII_REDACTOR_IMPL` URL is the selector; the two service URLs default to `http://presidio-analyzer:3000` / `http://presidio-anonymizer:3001`); any HTTP/parse failure raises `PIIRedactionError` (the pipeline's BLOCK semantics depend on it); timeout ≤ 2s per call (never-kill-chat belongs to the caller, but the redactor must not hang).
2. **compose**: `presidio-analyzer` + `presidio-anonymizer` services, image tags pinned to `2.2.362`, `genieai == true` placement, internal-only (no ports), healthchecks (analyzer needs a long `start_period` for the model download), fluent logging anchor.
3. **chatqna compose env** passes `PII_REDACTOR_IMPL`, `PRESIDIO_ANALYZER_URL`, `PRESIDIO_ANONYMIZER_URL` (this is what makes the config-validator cross-reference pass).
4. **`env` SECTION 15 extended** with the three PII vars (commented defaults: `regex` impl); **`env.j2` gains a SERVER-SIDE TOOLS section** rendering BOTH the web-search vars (fixing 2-1's E7 gap) and the PII vars, conditioned on group_vars presence; `deploy/ansible/group_vars/itu_rtx_test/vars.yml` (or `all.yml` — wherever SST defaults belong) documents the defaults.
5. **Tests**: HttpPIIRedactor unit tests (mock the HTTP layer: happy path counts entities + redacts, analyzer 500 → PIIRedactionError, timeout → PIIRedactionError, empty-entities fast path); config-validator suite green (`cd tests/config-validator && npm test`); overlay suite green; ruff clean.
6. `docker compose config` renders valid YAML with the new services (run with the standard env sourcing).

## Tasks / Subtasks

- [x] Task 1 — HttpPIIRedactor (AC: 1)
  - [x] Class after PresidioPIIRedactor in `pii_redactor.py`; use `urllib.request` (stdlib — keep the module dependency-free; httpx is available but the module currently imports nothing heavy) or `httpx` if already a workflows dependency — check web_search.py's imports and match; register in `create_pii_redactor`
- [x] Task 2 — compose services + chatqna env (AC: 2, 3)
  - [x] Mirror the searxng block; analyzer healthcheck `curl -f http://localhost:3000/api/v1/health` (verify the path against the Presidio API docs in-code comment; if uncertain use the root `/`), `start_period: 120s` for the model download; anonymizer healthcheck on 3001
- [x] Task 3 — env + env.j2 + group_vars (AC: 4)
- [x] Task 4 — Tests + validation (AC: 5, 6)
- [x] Task 5 — Trackers (sprint-status 1-6 → review, plan.md session log)

## Dev Notes

- **Failure = BLOCK**: the governance pipeline blocks tool calls when redaction raises (`governance.py:188-198`). HttpPIIRedactor must raise `PIIRedactionError` on any failure — never return the text unredacted, never swallow.
- The in-process `PresidioPIIRedactor` stays (some deployments may prefer it); the service shape is the epic-pinned default for production.
- **Do NOT add `presidio-analyzer`/`presidio-anonymizer` python packages** to any requirements — the HTTP impl needs no new deps.
- chatqna is currently the only governance consumer and it does NOT wire the pipeline yet (NFR11 backlog item) — the plumbing landed here is what that future wiring will consume. The env vars passing through chatqna's compose block is harmless today (regex default) and correct tomorrow.
- env.j2 style: copy an existing optional section (e.g. SECTION 18) — `{% if presidio_analyzer_url is defined ... %}PRESIDIO_ANALYZER_URL={{ ... }}` one var per `{% endif %}`-terminated block, or the group's established multi-var pattern; match whatever dominates the file.
- The config-validator allowlist (`APP_ONLY_VARS` or similar in the test file) — check whether `PII_REDACTOR_IMPL` etc. need adding there or whether the chatqna env reference satisfies crossReference.

### Testing standards

- Overlay: pytest, mock the HTTP layer at the transport (patch the request function, not the URL).
- config-validator: its own jest suite from `tests/config-validator/`.
- Compose render: `set -a && source .env` may not exist locally — `docker compose -f docker-compose.yaml config --quiet` with `--env-file env` substitutes from the template.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.6] — story text, E7 mirror requirement, AC (config:validate green, deploy renders vars, Presidio reachable)
- [Source: genie-ai-overlay/workflows/tools/pii_redactor.py:283-307] — the factory + the raising HTTP stub to replace
- [Source: docker-compose.yaml:588-617] — the searxng block to mirror
- [Source: deploy/ansible/templates/env.j2 (tail)] — SECTION 18-21 optional-var pattern; zero SST vars today (2-1's E7 gap)
- [Source: tests/config-validator/__tests__/config-validation.test.js] — the cross-reference suite + allowlist
- [Source: MCR registry API 2026-09-01] — tags verified live; 2.2.362 newest numeric
- Presidio image research: [Docker Hub microsoft/presidio-analyzer](https://hub.docker.com/r/microsoft/presidio-analyzer), [MCR presidio-analyzer tags](https://mcr.microsoft.com/en-us/artifact/mar/presidio-analyzer/tags)


### Review Findings

_Code review 2026-09-01 — all 3 layers; Edge Hunter + Auditor independently verified the REAL Presidio API against microsoft/presidio sources at the pinned tag 2.2.362. The verdict: the dev-phase implementation would have been DOA — 4 contract bugs, all invisible to the green suite because the tests mocked the wrong shapes._

- [x] [Review][Patch] **CRITICAL ×4 (Blind+Edge+Auditor) — the wire contract was wrong against the pinned images**: (1) analyzer response keys are `start`/`end`, not `start_position`/`end_position` (every entity mapped to 0,0); (2) the anonymize request key is `analyzer_results`, not `anonymizer_info` (HTTP 422 → BLOCK on every PII-bearing call); (3) **the anonymizer image listens on 3000** (ENV PORT=3000 upstream), not 3001 — all five config surfaces agreed on the wrong port; (4) both healthchecks probed nonexistent `/api/v1/health` (real route: `/health`) → permanently Unhealthy + Swarm flapping. ALL FIXED to the verified contract; tests rewritten to pin it.
- [x] [Review][Patch] **Fail-open coercion** (Blind+Edge+Auditor) — a non-list 200 body silently became "no entities" → **unredacted text returned as success**. FIXED: wrong-shape body raises; test pins the no-passthrough guarantee.
- [x] [Review][Patch] **Empty text → analyzer 500 → BLOCK** (Edge) — short-circuit added (matches RegexPIIRedactor); no HTTP call.
- [x] [Review][Patch] **Malformed entity fields raised raw TypeError/ValueError** outside the exception contract — wrapped into PIIRedactionError (+ test).
- [x] [Review][Patch] **2s timeout guaranteed first-call BLOCK** (spaCy cold-start) — now `PRESIDIO_TIMEOUT_SECONDS` (default 5s, env-tunable, test). **Recorded deviation from AC1's "≤2s"** — reality wins; NFR5's 100ms P99 is a steady-state target, not a cold-start one.
- [x] [Review][Patch] **Epic's `--profile tools` gate missing** (Auditor) — `profiles: [tools]` on both services (compose-up gates; Swarm ignores profiles, placement does the gating).
- [x] [Review][Patch] Dead `PRESIDIO_ANALYZER_DEFAULT_LANGUAGE` env (image has no such ENV; language is per-request) — removed; `# Factory` banner straddling the new class — moved; circular `_post`-stub failure test — replaced with a real transport failure; `web_search_time_patterns` + `searxng_url` missing from group_vars/env.j2 — added (SEARXNG_URL finally overridable via Ansible, the original E7 exemplar).
- [x] [Review][Dismiss] New AsyncClient per call — perf nit; not on a hot path (per-tool-call redaction), revisit if NFR5 evidence demands pooling.
- [x] [Review][Dismiss] `PII_REDACTOR_IMPL` URL value decorative (selector only; PRESIDIO_*_URL carry the endpoints) — documented in the class docstring.
- [x] [Review][Flag] Pre-existing: `docker compose config` fails on stream-ingestor → undefined `dataprep-arango-service` (3-x unwired; verified pre-diff via git stash) — surfaces to the 3-x owner, not fixed here.

## Dev Agent Record

### Agent Model Used

GLM-5.2 (Claude Code harness)

### Debug Log References

- Dev phase: 794 overlay + 25 config-validator green — **and completely wrong**: the tests mocked the fabricated API shapes, so 4 contract bugs sailed through
- Review verified the REAL API against microsoft/presidio at tag 2.2.362 (analyzer/anonymizer app.py, Dockerfiles, RecognizerResult.to_dict, AppEntitiesConvertor) — all four bugs confirmed twice independently
- Post-patch: **798 overlay** (10 HTTP-redactor tests incl. fail-closed + timeout), 25 validator, ruff clean, `docker compose --profile tools --profile opea config` renders valid
- Tooling lesson (third occurrence): python heredoc patch scripts that assert-match drift under ruff format — the Edit tool is the reliable path for formatted files

### Completion Notes List

- HttpPIIRedactor against the VERIFIED upstream contract: `/analyze` → `start`/`end` entities → `/anonymize` with `analyzer_results` → `{"text"}`; both services on container port 3000; fail-closed on every shape/transport/timeout failure; empty-text short-circuit; `PRESIDIO_TIMEOUT_SECONDS` (5s default — recorded deviation from the story's 2s)
- compose: presidio-analyzer + presidio-anonymizer pinned `2.2.362`, `profiles: [tools]`, `genieai` placement, internal-only, `/health` healthchecks (analyzer 120s start_period for the spaCy download); chatqna passes the three PII vars
- Config surfaces: env SECTION 15 extended (+PRESIDIO_TIMEOUT_SECONDS); env.j2 SECTION 22 renders all seven SST vars incl. SEARXNG_URL (the E7 exemplar — finally Ansible-overridable); group_vars documents every var
- Known dormant: `create_pii_redactor` is only constructed by GovernancePipeline, which has no production instantiation yet (NFR11 backlog) — a bad `PII_REDACTOR_IMPL` value cannot crash chatqna today; re-check at wiring time

### File List

- genie-ai-overlay/workflows/tools/pii_redactor.py (HttpPIIRedactor, verified contract)
- genie-ai-overlay/tests/test_governance.py (+10 HTTP-redactor tests)
- docker-compose.yaml (2 services, chatqna env)
- env, deploy/ansible/templates/env.j2, deploy/ansible/group_vars/all.yml
- _bmad-output/implementation-artifacts/{1-6 story, sprint-status, plan.md}

### Change Log

- 2026-09-01: Presidio-as-a-service + full plumbing; review caught 4 DOA contract bugs against the pinned images (verified upstream) — all fixed to the real API; 798 tests green → status review
## Debug Log References

### Completion Notes List

### File List

### Change Log
