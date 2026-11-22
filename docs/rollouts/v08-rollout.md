# V08 rollout record

- **Stage:** V08 — first stage rollout of the agentic routing path (Epic 3, story 3.3; the flag and rollback-continuity artifacts of stories 3.1/3.2 exercised on a real deployment)
- **Date:** 2026-11-22
- **Named responsible operator:** `jrevillard` (the initiative owner — the person who pulls the rollback trigger when a rollback trigger fires)
- **Venue:** the shared k3s dev cluster, namespace `genieai` (the V03 baseline venue; shared legacy stack untouched — the rehearsal ran DEDICATED workloads `v08-rehearsal-backend` / `v08-rehearsal-agent` + headless Service `v08-rehearsal-agent-hl`, all deleted and verified gone after the run)

## 1. Selected consumers and capabilities

- **Consumer:** the streaming chat entry `POST /api/queries/stream` (`initStreamQuery`), routed by the ONE shared routing helper (`components/gov-chat-backend/services/agent-routing.js`, `AGENT_ENABLED` read once at module load — the flag change takes effect on process restart). The non-streaming entry had no agentic serving path at the rehearsal's commit and refused honestly (`AGENTIC_PATH_NOT_SERVED`, story 3.1) — out of the rehearsal scope. **Update (post-rehearsal):** story 2.4b (the non-streaming JSON path, merged on the umbrella after this rehearsal) gives that entry an agentic serving path — the sentence describes the rehearsed commit, not the current branch; the per-stage re-run rule covers the added surface at its own stage's rehearsal.
- **Capability activated:** the agentic branch of the BFF — the frame writer (`agent-frame-writer.js`) proxying the agent-service run surface (`POST /v1/runs` seam stream) — served by a dedicated `v08-rehearsal-agent` pod carrying the same branch's agent-service image, wired to the venue's shared legacy services (chatqna, retriever, embedding, reranker, translation, ArangoDB, Keycloak, the external GPU gateway).
- **Flag off means exactly today:** with `AGENT_ENABLED=0` the legacy chatqna relay serves byte-identically — exercised in phase 5c and unchanged.
- **Rehearsal scope:** routing, pair and rollback mechanics. A full agent ANSWER is not provable on this venue — the GPU endpoint's tool-calling flags are not pinned (issue [#2052](https://opensource.unicc.org/un/itu/genie-ai/-/issues/2052)); the agentic direction's honest outcome is the run failing at the model leg. That is venue evidence (FR-26: recorded, never silently turned into a requirement); answer quality is #2052's acceptance, not this stage's.

## 2. Artifact and configuration versions

| Artifact                                   | Value                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source branch / commit                     | `feat/agentic-foundations/3-3-rehearsed-rollback-and-rollout-record-v08` @ `2b7f72aef` (docs-only follow-up commits after the rehearsal carry the same `components/` content)                                                                                                                                                                                                                |
| Backend image                              | `registry.opensource.unicc.org/un/itu/genie-ai/tmp/genie-ai-backend:pending-2b7f72ae` — manifest `sha256:f4308a9f6f03faa8f934aa568c66bee5001cc4d46b8d3614e1055b04ce15c7eb` (tag pipeline 18964, job `build:backend`)                                                                                                                                                                         |
| Agent image                                | `registry.opensource.unicc.org/un/itu/genie-ai/tmp/genie-ai-agent-server:pending-2b7f72ae` — manifest `sha256:20f8d402faa4a8f8aa5c067ea0c21475b579a87df788fb956762c0a9051680f9` (pipeline 18964, job `build:agent-service`)                                                                                                                                                                  |
| Build pipeline                             | tag `rehearsal-v08-2b7f72aef` → pipeline 18964 — CANCELED after both build jobs went green, before the promote stage (a non-prerelease tag's promote would retag `latest` and delete the `pending-*` source tags)                                                                                                                                                                            |
| Models served (venue GPU)                  | LLM `ibm-granite/granite-4.1-8b` (vLLM 0.29.0, `max_model_len 65536`, NO tool-calling flags — #2052), translation `google/gemma-3-4b-it`                                                                                                                                                                                                                                                     |
| Flags                                      | `AGENT_ENABLED=1` (activation) / `0` (rollback); BFF `AGENT_UPSTREAM_TIMEOUT_MS=3600000`, `AGENT_SERVICE_URL=http://v08-rehearsal-agent-hl:8080/v1/runs` (see §7, wire fact 1), `AGENT_TRANSLATION_MAX_TOKENS=4096`, `AGENT_TRANSLATION_MAX_CALLS=8` (rehearsal pins; the leg was never exercised — English requests)                                                                        |
| Agent budget knobs (REQUIRED, fail-closed) | `AGENT_RUN_MAX_STEPS=8`, `AGENT_RUN_MAX_MODEL_CALLS=12`, `AGENT_RUN_MAX_TOOL_CALLS=12`, `AGENT_RUN_MAX_TOTAL_TOKENS=50000`, `AGENT_RUN_MAX_EVIDENCE_BYTES=200000`, `AGENT_RUN_MAX_WALL_CLOCK_SECONDS=240`, `AGENT_TOOL_TIMEOUT_MS=30000`, `AGENT_TOOL_MAX_RESULTS=10`, `AGENT_TOOL_MAX_RESULT_BYTES=50000`, `AGENT_VERDICT_JUDGE_TIMEOUT_MS=30000`                                           |
| Agent port assembly                        | `AGENT_DOCREPO_URL=http://document-repository.genieai.svc.cluster.local`, `AGENT_OKF_URL=http://okf-server:3002` (nominal — OKF off on this venue), `AGENT_AUTHORIZED_GRAPHS=GRAPH`, `TEI_EMBEDDING_ENDPOINT=…:444/embed`, `TEI_RERANKING_ENDPOINT=…:444/rerank`, `VLLM_ENDPOINT=…:444/llm`, `OPEA_SSL_SKIP_VERIFY=1`, `ARANGO_*` = the venue's deployed values (`_system` / `GRAPH` / root) |
| Container port override (rehearsal-only)   | agent bound to **8080** via a deployment-level command override (`uvicorn app:app --port 8080`); the shipped image default stays 8010 (see §7, wire fact 2)                                                                                                                                                                                                                                  |

## 3. Activation procedure

```bash
# one flag, one process restart (the flag is read once at module load):
kubectl -n genieai set env deploy/<backend> AGENT_ENABLED=1
kubectl -n genieai rollout restart deploy/<backend>
kubectl -n genieai rollout status deploy/<backend> --timeout=180s
```

Rehearsal deployment used the identical semantics against the dedicated
`v08-rehearsal-backend` Deployment.

## 4. Rollback procedure

```bash
# the same switch in reverse — a process restart, nothing else moves:
kubectl -n genieai set env deploy/<backend> AGENT_ENABLED=0
kubectl -n genieai rollout restart deploy/<backend>
kubectl -n genieai rollout status deploy/<backend> --timeout=180s
```

No data migration, no conversation change, no agent-specific state required on
the legacy path (AD-12; exercised end-to-end in phase 5c).

## 5. In-flight treatment

**Observed (phase 5e, redo):** a legacy stream with chunks flowing was placed
under a `rollout restart` of the serving pod. The stream **completed on its
resolved path inside the shutdown window** — the client received the full
chunk sequence, the terminal `metadata` frame and `done` (queryId `4000614`,
`responseTime: 6354` ms), and the persisted doc reads `isAnswered: true` with
NO `answer_interrupted` marker. Timestamps: first chunk `04:43:44Z`, restart
triggered `04:43:48Z`, stream ended `04:43:49Z` (chunks flowing: 89 frames).

This is ADR agentic-003's rolling-restart variant: an in-flight stream keeps
its resolved path and finishes if it completes inside the stopping process's
shutdown window; a stream that does not fit the window ends like a hard stop
(doc stays `isAnswered: false`). The completed-in-window variant is what this
rehearsal observed; the hard-stop variant remains the documented policy for a
stream that outruns the window (and the honest-unanswered contract it carries
was evidenced by every failed agentic attempt: each left its at-start doc
`isAnswered: false`, nothing fabricated).

## 6. Rollback triggers and the named responsible operator

| Trigger                                                                                     | Response                                                                                                                                                                                      | Who            |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| The agentic path answers unacceptably in production (wrong, ungrounded, degraded vs legacy) | Execute §4 (flag off + restart) — the legacy path serves the very next request                                                                                                                | **jrevillard** |
| The pair invariant (§7 pair validation) stops holding after a configuration change          | Treat as a stage-gate BLOCKER: restore the timeout/deadline pair, or roll back per §4 until it holds                                                                                          | **jrevillard** |
| Agent-service outage (5xx / unreachable)                                                    | The agentic branch surfaces an honest error to the client; no silent legacy fallback exists by contract — roll back per §4 until the service recovers                                         | **jrevillard** |
| Any incident where attribution of a long run matters (CM-3)                                 | The pair rule keeps long runs surfacing as the agent's own honest `budget_exhausted`/`run_error`, never a BFF timeout — if a BFF timeout is observed, that is a broken pair: roll back per §4 | **jrevillard** |

## 7. Rehearsal evidence

**Pair validation (phase 5a) — from the DEPLOYED pods' env, not manifests:**

```
BFF pod:    AGENT_UPSTREAM_TIMEOUT_MS = 3600000   (≥ reserves + floor → no absorption)
Agent pod:  AGENT_RUN_MAX_WALL_CLOCK_SECONDS = 240
constants (agent-run-contract.js): TRANSLATION_RESERVE_MS=30000, FINALIZATION_MARGIN_MS=5000, DEADLINE_FLOOR_MS=1000

deadline_ms          = 3600000 − 30000 − 5000 = 3565000      (floor 1000 not binding)
effective_wall_clock = min(240, 3565000/1000) = 240 s
pair rule            = 3600000 ≥ 3565000 + 30000 + 5000 = 3600000   ✓ HOLDS (equality)
```

The invariant holds with equality — the deadline the BFF communicates is
exactly the timeout minus the named reserves. A long agent run surfaces as the
agent's own honest terminal, never a BFF-attributed abort (CM-3). Verdict:
**PAIR VALIDATED**.

**Agentic direction (phase 5b, `AGENT_ENABLED=1`)** — `POST
/api/queries/stream`, session `v08-rehearsal-20261122-052756`, question "What
is GENIE.AI?":

- The BFF routed to the rehearsal agent service: the agent's log carries
  `POST /v1/runs … 200 OK` from the backend pod, then the loop's model call
  and its honest failure:
  `agent run failed: ProbeTransientError: the generation endpoint answered 400: {'error': {'message': '"auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set', ...}}`
- The client received the legacy error contract verbatim:
  `data: {"type":"error","message":"ProbeTransientError: the generation endpoint answered 400: {…}","code":"AGENT_RUN_ERROR"}`
- The turn's `queries` doc stayed at-start (`isAnswered: false`) — the honest
  unanswered state, nothing fabricated.
- **The model-leg 400 is the venue's #2052 gap, recorded as evidence — not a
  rehearsal failure.** The routing hop, the real orchestrator, the real seam
  stream and the BFF frame projection are all proven by the same transcript.

**Rollback direction (phase 5c, `AGENT_ENABLED=0` + restart)** — SAME
session, next turn ("Continue the conversation: in one sentence, what is
GENIE.AI?"):

- Answered via LEGACY chatqna: real streamed chunks, the full terminal
  contract (`metadata` with `source_documents:[], confidence_score, is_grounded,
query_translation_status: passthrough_english` → `done` with `queryId
4000064`, `translationFailed: false`), 13 s wall clock.
- The persisted doc `4000064` reads `isAnswered: true` with the standard
  legacy field set (`okfRoutedGraphs, text, contextOption, userId, timestamp,
response, sessionId, …, metadata, isAnswered, messages, responseTime,
context`) — same shape, no migration (the 3.2 contracts live).
- History reads through the legacy path: `GET /api/queries?sessionId=…`
  (authorized to the rehearsal user) returned the whole session, 200.

**Re-activation direction (phase 5d, `AGENT_ENABLED=1` + restart)** — next
turn routed to the agent leg again (identical honest `AGENT_RUN_ERROR` at the
model leg). **Agentic↔legacy proven in BOTH directions on a real deployment.**

**In-flight switch (phase 5e)** — see §5: completed inside the shutdown
window, timestamps and doc evidence above.

**The #2052 venue note (FR-26):** the GPU endpoint's serving config carries
no `--enable-auto-tool-choice` / `--tool-call-parser` flags, so no tool call
can be observed on this venue (V06's headline finding, unchanged — scope
rationale in §1).

### Deployment findings the rehearsal surfaced (honest defects, recorded)

1. **Wire defect — the shipped `AGENT_SERVICE_URL` default cannot reach the
   agent's run surface.** The BFF POSTs the configured URL BARE
   (`axios.post(agentServiceUrl(), …)`, pinned by
   `__tests__/routes/agent-frame-writer.test.js`), while the agent service
   serves `POST /v1/runs` (pinned by its own suite) — both sides green under a
   mocked axios, never joined live until this rehearsal. On the deployed pair
   the hop answered `404` (agent log: `POST / HTTP/1.1 404`). Rehearsal
   workaround, deployment-level only: the path rides the env
   (`AGENT_SERVICE_URL=http://v08-rehearsal-agent-hl:8080/v1/runs` — axios
   posts the full URL verbatim). A code-side fix (the helper appends the run
   path, or the agent mounts a root alias) is filed as issue #2072
   (`status::backlog`) — outside this story's no-code boundary.
2. **The component NetworkPolicy egress list has no agent-port row.** The
   rehearsal backend's `component=backend` egress rules (which the chatqna
   hop requires) admit only specific ports — 8010 is not one, and this k3s
   REJECTS denied flows (`ECONNREFUSED`). Additionally this venue's netpol
   rejects pod→ClusterIP egress, so even a correctly-ported Service IP is
   unreachable. Rehearsal workaround, deployment-level only: the agent binds
   8080 (in the egress allow-list) and is exposed through a HEADLESS Service
   (DNS → pod IP). Flat compose networks (the shipped deployment shape) have
   no such restriction — this is a k8s-chart adoption item for the operator
   (the read-only `feat/k8s-migration` branch), filed as issue #2073
   (`status::backlog`).

## 8. Stage-gate FR-21 check (executed)

- **Mechanical half:** `cd tests/config-validator && npm test` on the tree
  this stage delivers — **green** (20 suites passed, 1 skipped; 674 tests
  passed, 34 skipped, 0 failures; run 2026-11-22). The OPEA-free gate
  (`__tests__/opea-free-gate.test.js`, CI job `config:validate`) scanned every
  tracked file of the audit scope.
- **Audit scope named:** `scripts/ci/agent-path-packages.json` →
  `agentPathPackages = [components/agent-service]` ("the agent service is the
  agentic path's own execution surface"). `components/gov-chat-backend` sits in
  `otherPackages` until story 3.1's manifest move; the BFF's agentic-branch
  leg is covered by the routing-helper + frame-writer tests, not the grep gate (AD-1, as
  recorded in the gate's own scope note).
- **Review verdict (FR-21):** **no new OPEA coupling was added that makes the
  deferred OPEA exit harder.** This stage's diff is records, runbook, gate
  instrument and rehearsal evidence only — no production code, no chart, no
  compose, no CI change (the story's Never list, honored; the two deployment
  workarounds above were applied to the REHEARSAL deployments only and deleted
  with them).

## Cleanup verification (end of run)

- `kubectl -n genieai get deploy,svc,pod` grep `v08-rehearsal` → empty.
- Rehearsal Keycloak user `v08-rehearsal` deleted (HTTP 204); remaining users
  by that name: 0.
- ROPC revert VERIFIED: `directAccessGrantsEnabled: false` read back from the
  `genie-app` client JSON (enabled 04:27:21Z → reverted+verified by 04:27:34Z;
  the first revert attempt hit a missing file and the corrective revert landed
  within 13 s of the enable — both transitions logged in the evidence).
- Rehearsal `queries` docs: 9 before delete → 0 after (AQL by the dedicated
  sessionId, verified).
- Port-forwards (keycloak, arango, backend) killed; transient pipeline
  schedule deleted (only the operator's monthly schedule remains); rehearsal
  pipelines 18961/18963/18964 all terminal (canceled/failed/canceled — 18963's
  `config:changelog` failure is the expected gate refusing a tag with no
  changelog entry). The two rehearsal TAGS remain on the remote: tag deletion
  is declined by the server's pre-receive hook (protected tag patterns) —
  recorded here as the one artifact that could not be removed; their
  registry-side `pending-*` tags age out under the registry cleanup policy.
