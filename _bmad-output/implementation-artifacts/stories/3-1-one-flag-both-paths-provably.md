---
title: 'Story 3.1 — One flag, both paths, provably'
type: 'feature'
created: '2026-11-22'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '19462a511bcd780f2845816ecfda94f845df90cc'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-genie-ai-2026-11-16/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — the issue #1972 acceptance criteria, operator-authored">

## Intent

**Problem:** The BFF's two request entries — `initStreamQuery` (the `/stream` path) and `createQuery` (the non-stream path) — are genuinely separate code that each builds its own upstream target. The BFF has no activation branch at all: `AGENT_ENABLED=1` stands up the agent service that nothing routes to, and when the agentic serving path lands (stories 2.4/2.4b) each entry would wire its own branch — the half-activated deployment (one path agentic, the other legacy) this story exists to make impossible.

**Approach:** ONE shared routing helper in the BFF query path resolves the upstream route from the single `AGENT_ENABLED` flag (FR-15/AD-9). Both entries branch through it at the same lifecycle position (before the query record is persisted). Flag off: the route is exactly today's chatqna/OPEA URL and nothing else changes (D02). Flag on: both entries take the agentic route — whose target is the agent service and can never be the chatqna/OPEA URL, proven behaviorally (the AD-1 BFF-leg test, because the CI dependency gate cannot see the BFF runtime call graph) — and refuse honestly until the frame writer (story 2.4) serves the branch. Tests assert the two entries cannot disagree.

**Acceptance criteria (issue #1972, the contract):**
- Given the routing seam (`initStreamQuery` for `/stream`, `createQuery` for the non-stream path — genuinely separate code), when the flag switches, then both paths branch through one shared routing helper, with a test asserting the two entries cannot disagree.
- And the agentic branch never targets the chatqna/OPEA URL (the AD-1 BFF-leg test — grep cannot see this).
- And with the flag off, every request behaves exactly as today (legacy path untouched, D02).

## Boundaries & Constraints

**Always:**
- One flag: `AGENT_ENABLED` — Epic 1's deployment flag, strict `'1'` activates (matching the compose `AGENT_ENABLED 0/1` contract); every other value, including unset, is legacy. No second flag, no per-entry override, no `true`/`yes` vocabulary.
- One helper: both entries resolve their upstream target from the same module-level helper (`resolveQueryRoute`); the decision is taken once per request, before the query record is saved — a refused request leaves no persisted query doc.
- Flag-off byte-identity (D02): the legacy target comes from the unchanged `opeaChatQnaUrl()` (OPEA_HOST/OPEA_PORT honored, the documented `chatqna-xeon-backend-server:8888` fallback); validation, persistence, fanout carrier, payload shapes, and both routes' SSE/JSON flows untouched; `test-mode` unaffected when the flag is off.
- Agentic target is deployment configuration with the legacy leg's own convention (env `AGENT_SERVICE_URL`, default `http://agent-service:8010` — the compose service name + the documented port; compose and the chart set it), never derived from request data.
- Flag-on refusal: fail-closed, before persistence, marker `AGENTIC_PATH_NOT_SERVED` naming story 2.4 as the deliverer, identical on both entries — never a silent legacy fallback under an activated flag.

**Never:**
- No agent-leg HTTP client, no frame writer, no disconnect detection — the agentic serving path is story 2.4 (stream) / 2.4b (JSON); this story only routes and refuses.
- No agent-service (Python) changes; no compose/ansible/gateway changes beyond documenting the new knob in the `env` template (the commented-line pattern — the default already matches the compose topology).
- The agentic branch never constructs or targets the chatqna/OPEA URL — carried by a behavioral test on the resolved route, not by a grep.
- No change to the legacy path when the flag is off — the D02 clause is regression-pinned by the existing suites staying green unmodified.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Flag off, `/stream` | `AGENT_ENABLED` unset / `0` / non-`1` | route legacy; `opeaUrl` equals the unchanged `opeaChatQnaUrl()` construction; request flows byte-identically to today | N/A |
| Flag off, non-stream | same | same legacy decision; the worker receives the helper's URL (one construction source) | N/A |
| Flag on, `/stream` | `AGENT_ENABLED=1` | refuses with `AGENTIC_PATH_NOT_SERVED` before the query record is saved | Error names story 2.4 |
| Flag on, non-stream (incl. `test-mode`) | `AGENT_ENABLED=1` | the same refusal; the worker is never called; no query record | Same marker, both entries |
| Flag on + override | `AGENT_ENABLED=1`, `AGENT_SERVICE_URL` set | agentic target = the override; never the OPEA URL, whatever `OPEA_HOST`/`OPEA_PORT` say | N/A |
| Decision symmetry | any one environment | both entries resolve the SAME decision (the disagreement test — equality asserted for both flag states) | N/A |

## Code Map

- `components/gov-chat-backend/services/query-service.js` -- `opeaChatQnaUrl()` (:57-59, the frozen legacy construction); `initStreamQuery` (:559; builds `opeaUrl` :629); `createQuery` (:921; the worker-path URL :1040, behind the `test-mode` bypass); module exports (:2229-2233, `instance` + named extras). The helper lands beside `opeaChatQnaUrl`; both methods branch through it.
- `components/gov-chat-backend/routes/query-routes.js` -- `/stream` handler consumes `initStreamQuery`'s `opeaUrl` (:346; the throw lands before `writeHead`, so the refusal takes the ordinary JSON error path); non-stream route (:896). Read-only — no route changes needed.
- `components/gov-chat-backend/__tests__/services/query-service.test.js` -- the mock/`withEnv`/`jest.spyOn(queryService, 'runOPEAWorker')` patterns (:780-826); `test-mode` bypass usage (:707+).
- `env` -- the AGENT feature-flag block (:1414+); the new knob documents as a commented line there (the `CHATQNA_STREAM_TIMEOUT` pattern — an unset override needs no compose/ansible wiring).
- `CHANGELOG.md` -- `[Unreleased]` / Added: the deployer-visible knob.

## Tasks & Acceptance

**Execution:**
- [x] `components/gov-chat-backend/services/query-service.js` -- `agentServiceUrl()` + `resolveQueryRoute()` beside `opeaChatQnaUrl()`, exported for tests; both entries resolve the route once, refuse `AGENTIC_PATH_NOT_SERVED` when agentic (before the save), else use `route.url` where they built the OPEA URL today -- the AC's shared branch
- [x] `components/gov-chat-backend/__tests__/services/query-service.test.js` -- the routing suite: decision symmetry (both entries, both flag states), the AD-1 behavioral never-OPEA assertion, flag-off URL identity (default + OPEA_HOST/OPEA_PORT override), flag-on refusal before persistence on both entries (worker never called, `test-mode` refuses too), override honored -- every matrix row executable
- [x] `env` -- commented `AGENT_SERVICE_URL` line in the AGENT block, documented -- operators can retarget the branch
- [x] `CHANGELOG.md` -- `[Unreleased]` / Added: the knob -- deployer-visible config change
- [x] `_bmad-output/implementation-artifacts/stories/3-1-one-flag-both-paths-provably.md` + `sprint-status.yaml` -- story file to `in-review`, row `3-1-one-flag-both-paths-provably` + `epic-3` per the sync rule -- BMAD bookkeeping

**Acceptance Criteria:**
- Given the routing seam, when the flag switches, then both entries branch through the one shared helper and the symmetry test proves the two entries resolve the same decision for the same environment in both flag states.
- Given the flag on, when either entry resolves its upstream, then the agentic target is the agent service and never the chatqna/OPEA URL — asserted behaviorally on the resolved route (the AD-1 BFF-leg test).
- Given the flag off, when any request arrives, then the resolved URL is exactly today's construction (default and overrides), and the full legacy backend suite stays green unmodified.
- Given the flag on, when either entry refuses, then the refusal carries the same `AGENTIC_PATH_NOT_SERVED` marker on both entries and leaves no persisted query record.

## Implementation Notes

<!-- Agent-owned. Append-only during implementation. -->

- **Landed as designed.** The helper (`resolveQueryRoute` + `agentServiceUrl`) sits beside `opeaChatQnaUrl` in `services/query-service.js`; both entries resolve the route right after validation, before the save. `opeaChatQnaUrl` keeps its only remaining caller (the helper's legacy branch) — no dead code.
- **Review round 1 (global): four findings, all fixed.**
  1. *Important — compose never passed the flag into the BFF container.* The helper reads `process.env.AGENT_ENABLED`/`AGENT_SERVICE_URL`, but the compose `backend` service's environment block did not list either — the stack-side route to the exact half-activated deployment this story prevents (agent service up, BFF silently legacy). Fixed: both wired in the `backend` block with the deployment defaults; a config-validator guard pins the wiring (a container's unreachable variable cannot ship again silently).
  2. *Story references in the shipped refusal string and helper comments.* Removed — the refusal message is self-contained prose; the string is also now ONE shared constant (`agenticRefusalError`), so the two entries cannot answer an activated flag with different refusal texts (cross-entry message/code equality pinned in the test).
  3. *Refusal surfaced as 500.* Both routes map the refusal to **503 with `AGENTIC_PATH_NOT_SERVED` as the machine-readable error code** (the SSE error frame carries the same code) — an intentional, configuration-driven state must not read as an unexpected server fault to monitors and retry clients.
  4. Compose comment style note: the new wiring comment describes the invariant (unreachable-variable rule), matching the !1073 convention.
- **Simplify round (4 quality lenses, all applied).** The entries now consume ONE guard helper (`resolveLegacyQueryUrl` — routing decision + refusal + legacy URL in one call, taken at the same pre-record position in both entries); both route catches map the refusal through the repo's general typed-error passthrough (`error.statusCode && error.code` → `res.status(error.statusCode).json({error: error.code, ...})` — the mechanism other route files already use, instead of an identity-matched special case; the refusal's `statusCode: 503` is the load-bearing declaration); the config-validator wiring guard reads the structured parsers (`parseComposeServiceContracts`, `parseEnvTemplate`) instead of raw text regex, keeping only the exact-default pins; the ansible channel carries the pair too (`env.j2` + `group_vars` — the flag and its target never half-wire on one deployment channel); duplicated rationale comments trimmed to the local invariant; a subsumed assertion dropped. Skipped: none (the "drop statusCode" suggestion was superseded — the passthrough makes the field production-read).
- **Flag-on refusal, not silent legacy.** With `AGENT_ENABLED=1` and no serving path yet, refusing loudly keeps "activation" truthful (FR-15): a deployment that flips the flag gets an honest named error on BOTH paths instead of legacy answers dressed as agentic ones — or an agentic label on legacy answers. The refusal sits before the save, so a flipped flag also mints no half-persisted records. Story 2.4 replaces the refusal with the frame writer at the same branch.
- **Strict `'1'`.** The compose contract documents `AGENT_ENABLED` as `0/1` ("MUST be 0 or 1, not true/false"). The helper reads the same vocabulary; a stray `true` is legacy, not activation.
- **`test-mode` refuses too.** The routing decision is the request's upstream truth; a mocked OPEA answer under an activated flag would present itself as an agentic answer. The decision precedes the mode bypass.

## Verification

**Commands:**
- `cd components/gov-chat-backend && npx jest __tests__/services/query-service.test.js` -- expected: all green, including the new routing suite
- `cd components/gov-chat-backend && npm test` -- expected: the full backend suite green unmodified (the D02 regression pin)
- `cd components/gov-chat-backend && rtk proxy npx eslint services/query-service.js __tests__/services/query-service.test.js` -- expected: clean
