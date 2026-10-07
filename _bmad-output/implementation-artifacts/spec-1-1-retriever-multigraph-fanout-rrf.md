---
title: 'Story 1.1 — Retriever multi-graph fan-out: e2e chatqna integration (unblocks OKF queries)'
type: 'feature'
created: '2026-10-06'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'e377016de362a398de1603dde2a7d1c716ea0411'
context:
  - '{project-root}/_bmad-output/planning-artifacts/okf-fanout-course-correction-2026-09-20.md'
  - '{project-root}/_bmad-output/implementation-artifacts/1-0-retriever-provenance-materialization.md'
  - '{project-root}/_bmad-output/implementation-artifacts/1-0b-boundary-probe-graph-names.md'
  - '{project-root}/_bmad-output/implementation-artifacts/1-7-retrieval-mode-governance-config.md'
  - '{project-root}/_bmad-output/implementation-artifacts/6-1b-authz-resolver-token-to-graph-set.md'
  - '{project-root}/.claude/rules/DEBUGGING-TRACING.md'
---

<!-- Target: 900–1300 tokens. Above 1600 = high risk of context rot. -->

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The retriever-side fan-out scaffolding is shipped (commits 18b34cd13 + 60b9355ce + 596a11fcd on feat/okf-server — `_extract_for_graph`, `invoke_fanout`, `asyncio.Semaphore`, per-leg timeout, Level-2 RRF, provenance attach are all in `genie-ai-overlay/retriever/genieai_retriever_arangodb.py:958-1656`), and chatqna is wired to receive the carrier (`encode(..., graphs=_graph_names)` at `genieai_chatqna.py:1020`). But end-to-end fan-out never engages because **the backend BFF never passes `authorized_graph_names` to chatqna** (`components/gov-chat-backend/services/query-service.js:421-434` builds the chatqna payload without that kwarg), and **chatqna does not read `/api/okf/retrieval-config` to resolve the runtime mode**. Result: OKF queries return zero hits from OKF graphs today even when repos are published and ingested. This is the LG-1 launch gap for fan-out.

**Approach:** Wire the BFF (1) to read the runtime retrieval config from okf-server (with a TTL cache per ADR-039 D2), (2) to use the `engaged: bool` field in that response as the authoritative engagement signal (it already encodes `mode ∈ {okf_only, hybrid} AND servingCount >= 1` per the server's gate at `retrieval-config-service.js:184`), (3) to call okf-server's `GET /api/okf/authz/graphs` to resolve the caller's authorized graph set per turn (only when `engaged: true`), then (4) to pass `authorized_graph_names` as a kwarg in the chatqna OPEA payload — prepending `ARANGO_GRAPH_NAME` only when `mode == 'hybrid'`, never when `mode == 'okf_only'` (per the canonical fan-out carrier shape test at `genie-ai-overlay/tests/test_chatqna_fanout_carrier.py:88-90`). Legacy single-graph path is the explicit safety floor — the wire-up must default to it whenever `engaged: false` (which subsumes all of: `mode == legacy`, `mode ∈ {okf_only, hybrid} AND servingCount == 0`, or okf-server unreachable), byte-identical to today's behaviour. CI-asserted on seed fixtures (amendment G, ADR-039 D8).

## Boundaries & Constraints

**Always:**
- Legacy path byte-identical when the **server's `engaged: false` flag** is returned from `GET /api/okf/retrieval-config` AND `config.mode != 'okf_only'` (see the next rule for the `okf_only` exception). The legacy-byte-identical case subsumes: `mode == legacy`, `mode == 'hybrid' AND servingCount == 0`, the authz resolver returns an empty set, the okf-server is unreachable (last-known-good defaults to `legacy` → `engaged: false`), OR `RETRIEVER_FANOUT_ENABLED=false` on the retriever container. In all those cases, the chatqna OPEA payload is byte-identical to today's `opeaPayload.context` (same field set, same values, same ordering). The chat-side tests `tests/test_chatqna.py` that mock `core.label_contract.encode_filter_labels` must still pass without modification.
- **`okf_only` means OKF only — NEVER query the legacy free-form corpus** (per the resolved Open Question, 2026-10-06). When `config.mode == 'okf_only'`, the legacy `ARANGO_GRAPH_NAME` is NEVER queried, regardless of `engaged` or the authz-resolver response. Implementation: the BFF passes a new kwarg `exclude_legacy: true` to chatqna; chatqna extends `core.label_contract.encode` with a third signal segment `::no_legacy:`; the retriever's `_fanout_should_engage` and the legacy `ARANGO_GRAPH_NAME` fallback BOTH check the signal and refuse to query the legacy corpus. This is the only case in this spec where retriever-side AND chatqna-side code is touched (an additive segment + an additive kwarg; the legacy path remains byte-identical when the signal is absent).
- Engagement gate is the SERVER's `engaged` flag, NOT the mode alone. Per `retrieval-config-service.js:184` the server computes `engaged = (mode === 'okf_only' || mode === 'hybrid') && servingCount >= 1` — a corrupted mode value can never switch the fan-out on (ADR-039 D2 whitelist). The BFF reads `engaged` and acts on it. Re-computing the gate client-side is forbidden (would re-introduce the very bug the server-side gate was created to prevent).
- Mode is resolved server-side: BFF reads `GET /api/okf/retrieval-config` per session (≤30s TTL, last-known-good on failure — the same seam as the `okf_system_config` service) and never trusts client-supplied mode. The response carries `config.mode`, `serving_graph_count`, `serving_graphs[]`, `engaged: bool`, and `warnings[]` — the BFF consumes all five.
- Per-call authz: when `engaged: true`, BFF ALSO reads `GET /api/okf/authz/graphs` per turn with the caller's bearer token, filtered to repos that are `lifecycle_state==='publish' && ingested_at && !deleted_at` (the Ingested-lane truth, frontend's `laneFor` predicate). When `engaged: false`, the BFF MAY skip the authz call (the carrier is empty regardless). Cache TTL ≤30s, mirrors the authz-resolver service's `SERVING_TTL_MS`. Cache key is `(effective_scopes, ttl_window)` — scope-equivalence inference is safe because the authz-resolver already filters by the caller's `authorized_repo_ids` (the resolver is the isolation boundary; the cache is the latency optimization, not a separate authz layer).
- **Legacy-GRAPH injection rule (per the canonical carrier shape test at `genie-ai-overlay/tests/test_chatqna_fanout_carrier.py:88-90`):** When `engaged: true` AND `config.mode == 'hybrid'`, the BFF prepends `process.env.ARANGO_GRAPH_NAME` (the legacy free-form corpus name) to the authz-resolver's `graph_names[]` to produce the carrier — legacy first, OKF graphs after. When `engaged: true` AND `config.mode == 'okf_only'`, the BFF does NOT prepend — the carrier carries only the OKF graphs. This is the single rule that decides whether the legacy free-form corpus is included in the fan-out.
- Env-var surface: `RETRIEVER_FANOUT_ENABLED` is the master kill switch (already in `genie-ai-overlay/retriever/config.py:241`, default `"true"`, documented in the retriever config — NOT in the root `env` file by design: the env file's own comment says "these env vars can never enable the fan-out on a misconfigured deployment"). `OKF_RETRIEVAL_MODE` (boot default `legacy`) is the mode knob. The new BFF-side code reads only the okf-server endpoint, never the env vars directly. The BFF reads `process.env.ARANGO_GRAPH_NAME` to know which legacy graph name to prepend in `hybrid` mode (default value matches the env file's `ARANGO_GRAPH_NAME=GRAPH`).
- Per-hit provenance preserved end-to-end: every retrieval hit must carry `graph_name`, `repo_id`, `concept_id` (per Story 1.0). No re-numbering, no reshaping, no schema migration.
- i18n ×14 gate (ar, bn, de, en, es, fr, id, man, pt, ru, st, sw, th, zh) for any user-visible surface; site-docs gate for any architectural change (per amendment H).

**Never:**
- Do NOT mutate the Pydantic `ChatCompletionRequest` model in chatqna to inject `authorized_graph_names` (per 1-0 Decision A; the existing kwarg surface is the right seam).
- Do NOT call the okf-server endpoints from chatqna directly (the BFF is the trusted side; chatqna stays a service consumer, not a service integrator).
- Do NOT cache the authz graph set on the BFF key by anything less specific than `(effective_scopes, ttl_window)` was the original constraint — that was the SCOPED_KEY direction (resolved). The implementation MUST NOT cache by raw `bearer_token_hash` (memory bloat, no isolation benefit). The authz-resolver is the isolation boundary; the cache is a latency optimization that uses scope-equivalence.
- Do NOT change the `_fanout_should_engage` semantics — those are pinned in contracts/ (`fanout_enabled AND bool(encoded_graph_names)`; the carrier is the single source of truth per 1-0 Decision D).
- Do NOT remove or weaken the existing `_filter_labels` path. The labels branch (`encode_filter_labels` at chatqna line 1012) stays the legacy call surface.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| LEGACY_DEFAULT | `OKF_RETRIEVAL_MODE=legacy` (boot default); no `okf_system_config` doc; `/api/okf/retrieval-config` returns `engaged: false` | BFF reads `engaged: false`, sends chatqna payload **byte-identical to today** — same `opeaPayload.context` keys/values, no `authorized_graph_names` kwarg, chatqna `encode_filter_labels` path runs. Retriever's `_fanout_should_engage` returns `False`; legacy `ARANGO_GRAPH_NAME` path runs. | N/A |
| HYBRID_WITH_SERVING | `mode=hybrid`, 2 OKF repos ingested, caller has read scope on both; `/api/okf/retrieval-config` returns `engaged: true` | BFF reads `engaged: true`; calls `GET /api/okf/authz/graphs` → gets `['OKF_<a>_v1', 'OKF_<b>_v1']` (no GRAPH — the authz-resolver never returns GRAPH); BFF prepends `process.env.ARANGO_GRAPH_NAME` (the legacy corpus name, default `'GRAPH'`) to produce `['GRAPH', 'OKF_<a>_v1', 'OKF_<b>_v1']`; passes `authorized_graph_names` kwarg to chatqna. Chatqna encodes the carrier (`encode(..., graphs=[...])` at chatqna.py:1020). Retriever's `invoke_fanout` runs with 3 legs; per-leg `asyncio.Semaphore(5)`, per-leg `asyncio.wait_for(2s)`, Level-2 RRF fuses; per-hit provenance populated (`graph_name` for every result). | Per-leg timeout → 0 hits from that leg, INFO log; missing graph → 0 hits, INFO log; partial result returned to chat. |
| OKF_ONLY_WITH_SERVING | `mode=okf_only`, 2 OKF repos ingested, caller has read scope on both; `/api/okf/retrieval-config` returns `engaged: true` | BFF reads `engaged: true`; calls authz/graphs → `['OKF_<a>_v1', 'OKF_<b>_v1']`; BFF does NOT prepend `ARANGO_GRAPH_NAME` (the rule: `okf_only` excludes the legacy free-form corpus); passes `['OKF_<a>_v1', 'OKF_<b>_v1']` to chatqna. Retriever's `invoke_fanout` runs with 2 legs (OKF only). | Same per-leg resilience as HYBRID_WITH_SERVING. |
| HYBRID_ZERO_SERVING | `mode=hybrid`, 0 OKF repos ingested; `/api/okf/retrieval-config` returns `engaged: false` (server gate: `mode ∈ {okf_only, hybrid} AND servingCount >= 1`) | BFF reads `engaged: false`; does NOT call authz/graphs (carrier is empty regardless); passes empty `authorized_graph_names`; chatqna defaults to empty carrier; retriever's `_fanout_should_engage` returns `False`; legacy `ARANGO_GRAPH_NAME` path runs (D8 invariant). No warning (hybrid+zero-serving is normal free-form-only operation per `retrieval-config-service.js:189-190`). | N/A |
| OKF_ONLY_ZERO_SERVING | `mode=okf_only`, 0 OKF repos; `/api/okf/retrieval-config` returns `engaged: false` AND `warnings: ['okf_only with zero serving graphs — OKF contribution is zero']` | BFF reads `engaged: false` AND `mode == 'okf_only'`; passes `authorized_graph_names: []` AND `exclude_legacy: true` kwarg to chatqna. Chatqna encodes the carrier + the new `::no_legacy:` segment. The retriever's `ARANGO_GRAPH_NAME` fallback is refused (legacy corpus is NEVER queried in `okf_only`); the result is zero hits from any graph. AND the BFF records a structured `fanout.warning: "okf_only_zero_serving"` telemetry event (consumed by the admin dashboard, NOT surfaced to the user chat). | Warning is server-emitted; BFF surfaces it via the chat response metadata. |
| UNAUTHORIZED_REPO | caller has read scope on 1 of 3 ingested repos, `mode=hybrid`, `engaged: true` | BFF's `authz/graphs` call returns ONLY the 1 authorized graph (the other 2 are filtered by the authz-resolver's `authorizedRepoIds` intersection with `serving` — never reach the response); BFF prepends GRAPH (hybrid mode); carrier carries `['GRAPH', 'OKF_<authorized>_v1']`; unauthorized repos contribute zero hits by construction (the resolver is the isolation boundary). | N/A |
| BFF_CANNOT_REACH_OKF_SERVER | okf-server down or `/api/okf/retrieval-config` 5xx | BFF uses last-known-good config (defaults to `mode=legacy` if never read, which yields `engaged: false`); passes empty `authorized_graph_names`; legacy `ARANGO_GRAPH_NAME` path runs; BFF logs a WARN with `correlation_id`. | Fail-closed: never escalates to fan-out on a config outage. |
| RETRIEVER_FANOUT_ENABLED=false | env var set to "false" on the retriever container | Regardless of BFF behavior (BFF is unaware of this env var), the retriever's `_fanout_should_engage` returns `False` and the legacy `ARANGO_GRAPH_NAME` path runs. The BFF's payload may carry `authorized_graph_names: ['GRAPH', OKF_<a>_v1]`; the retriever silently falls back to legacy. | The kill switch is the retriever's; the BFF has no override. |
| BEARER_TOKEN_EXPIRED | BFF's `authz/graphs` call returns 401 | BFF surfaces the same 401 to the chat client; legacy path is NOT silently engaged (the request is invalid). | 401 propagates to client; no fallback to fan-out. |
</frozen-after-approval>

## Code Map

- `components/gov-chat-backend/services/query-service.js:421-434` — current chatqna OPEA payload construction; **add** `authorized_graph_names` kwarg + `mode` field to `context` (read-only context; chatqna's existing kwarg-handling at chatqna.py:1007-1020 already consumes it). The carrier construction reads the client's `engaged: bool` (per the `Always` Boundary) and applies the **GRAPH-injection rule** (prepend `ARANGO_GRAPH_NAME` only when `mode == 'hybrid'`; omit when `mode == 'okf_only'`; empty list when `engaged: false`).
- `components/gov-chat-backend/services/retrieval-config-client.js` (NEW) — BFF-side client for `GET /api/okf/retrieval-config` + `GET /api/okf/authz/graphs`; TTL cache (≤30s) keyed `(mode_token, bearer_hash, ttl_window)`; last-known-good on failure; structured logging with correlation_id (per `feedback_verbose-logging.md`).
- `components/gov-chat-backend/__tests__/retrieval-config-client.test.js` (NEW) — mocked unit tests for the cache hit/miss/expiry/failure paths.
- `components/gov-chat-backend/__tests__/query-service-fanout.test.js` (NEW) — `opeaPayload` shape assertions for each I/O Matrix scenario; mocks the new client.
- `components/gov-chat-backend/__tests__/e2e-fanout.test.js` (NEW) — supertest-driven end-to-end against a stubbed okf-server + chatqna: (a) `mode=legacy` payload byte-identical to today (regression guard), (b) `mode=hybrid` payload carries `authorized_graph_names` with the right shape, (c) bearer scope leakage guard (two different users get different graph sets).
- `genie-ai-overlay/retriever/genieai_retriever_arangodb.py:927-936` (READ-ONLY) — existing fan-out branch; no changes. The contract `tests/test_fanout.py::TestFanoutShouldEngage` is the canonical pin for engagement semantics.
- `genie-ai-overlay/chatqna/genieai_chatqna.py:1007-1020` (ADDITIVE EXTEND per the resolved Open Question) — the existing carrier encode is extended with a third `exclude_legacy` kwarg; when true, `core.label_contract.encode` writes a parallel `::no_legacy:` segment in `search_start` (matching the existing labels / graphs segment pattern). The new kwarg defaults to `False` (preserves every existing test in `tests/test_chatqna.py` and `tests/test_chatqna_fanout_carrier.py`; the canonical fan-out carrier shape test gets a sibling case). The `1-2` AC1 test (`596a11fcd test(chatqna): Story 1.2 AC1 carrier shape`) remains the canonical pin for the labels/graphs carrier shape; this story adds the no-legacy segment.
- `genie-ai-overlay/core/label_contract.py` (ADDITIVE EXTEND) — `encode(base_mode, labels, graphs, no_legacy=False)` and `decode(search_start)` extended to peel the third segment order-insensitively (same pattern as the existing labels/graphs peel — `ORDER-INSENSITIVE dual-segment decode` per `tests/test_label_contract.py:60-66`). Default `no_legacy=False` preserves every existing test.
- `genie-ai-overlay/retriever/genieai_retriever_arangodb.py:927-953` (ADDITIVE EXTEND per the resolved Open Question) — the fan-out branch (line 927-933) and the legacy `ARANGO_GRAPH_NAME` fallback (line 945-953) BOTH consult a new `_exclude_legacy: bool` decoded from `search_start`; when `True`, the legacy `ARANGO_GRAPH_NAME` fallback is refused and an INFO log is emitted (the existing `retriever.fanout` span gains a new `okf.fanout.exclude_legacy` attribute for the Studio card). When `False` (the default), the existing byte-identical path runs. The pinned contract `tests/test_fanout.py::TestFanoutShouldEngage` is extended with sibling cases; the existing test bodies pass unchanged.
- `components/okf-server/services/retrieval-config-service.js:176-220` (READ-ONLY) — existing `getRetrievalConfig` endpoint; no changes. Already exposed at `GET /api/okf/retrieval-config`.
- `components/okf-server/services/authz-resolver-service.js` (READ-ONLY) — existing `GET /api/okf/authz/graphs` endpoint; no changes. Already exposes the per-caller graph set.
- `components/okf-server/scripts/check-okf-repo.js:354` (EXTEND) — add **Step 5: retriever end-to-end**: a real HTTP POST to the retriever microservice with the carrier `[ARANGO_GRAPH_NAME, OKF_<ingested_repo>_vN]`; assert (a) response is non-empty list, (b) every doc.metadata has `graph_name` in the requested set, (c) both legs contributed at least one result. The legacy-mode regression check is a separate Step 5b: payload without the carrier must produce the pre-1-0 result shape (requires capturing a pre-change output snapshot — out of scope for this spec; note for Story 8.4 or future test-cell work).

## Tasks & Acceptance

**Execution:**
- [x] `components/gov-chat-backend/services/retrieval-config-client.js` -- CREATE: TTL-cached client for `/api/okf/retrieval-config` + `/api/okf/authz/graphs`; **cache key = (effective_scopes, ttl_window)** per the resolved Open Question (SCOPED_KEY, faster, isolation preserved by the authz-resolver's per-caller authorized_repo_ids filter); ≤30s TTL mirrors `SERVING_TTL_MS`; last-known-good on failure (defaults to `mode=legacy` if never read); structured logs with correlation_id; **exposes the server's `engaged: bool` as the authoritative engagement signal** (the client MUST NOT re-compute the gate from mode+servingCount locally) -- so the BFF can resolve the runtime mode + caller graph set per turn.
- [x] `components/gov-chat-backend/services/query-service.js` -- MODIFY: in `opeaPayload.context`, add `mode` (resolved via the new client), `authorized_graph_names` kwarg, and **the new `exclude_legacy: true` kwarg** (only set when `mode == 'okf_only'`) to chatqna (via the existing OPEA `kwargs` channel); the carrier construction reads the client's `engaged: bool` to decide whether to pass the kwarg at all, and applies the legacy-GRAPH injection rule: when `engaged: true AND mode == 'hybrid'`, prepend `process.env.ARANGO_GRAPH_NAME` to the authz-resolver's `graph_names[]` (legacy first, OKF after); when `engaged: true AND mode == 'okf_only'`, do NOT prepend AND pass `exclude_legacy: true`; when `engaged: false AND mode != 'okf_only'`, pass an empty list (or omit the kwarg entirely for byte-identical legacy behavior); when `engaged: false AND mode == 'okf_only'`, pass `exclude_legacy: true` and empty list -- so the chatqna carrier is populated from the server-side resolution, not from the client.
- [x] `genie-ai-overlay/core/label_contract.py` -- ADDITIVE EXTEND: add `no_legacy: bool = False` parameter to `encode()`; writes a `::no_legacy:` segment in `search_start` when True (matching the existing labels/graphs segment pattern); extend `decode()` to peel the third segment order-insensitively. Default `False` preserves every existing test in `tests/test_label_contract.py`. The new segment is mutually-exclusive with the graphs/legacy interaction (a single carrier may carry graphs + no_legacy).
- [x] `genie-ai-overlay/chatqna/genieai_chatqna.py:1007-1020` -- ADDITIVE EXTEND: thread the new `exclude_legacy` kwarg from the BFF through `align_inputs` into the `encode(...)` call; default `False` preserves the existing fan-out carrier shape test `tests/test_chatqna_fanout_carrier.py:88-90` (no_legacy=False → existing carrier shape, no `::no_legacy:` segment).
- [x] `genie-ai-overlay/retriever/genieai_retriever_arangodb.py:927-953` -- ADDITIVE EXTEND: decode `_exclude_legacy: bool` from the carrier (parallel to `_encoded_graph_names` at line 902); the legacy `ARANGO_GRAPH_NAME` fallback at line 945 is refused when `_exclude_legacy: True` (return `[]` with an INFO log naming the reason). The fan-out branch at line 927 is unchanged (no_legacy does NOT affect fan-out when graphs are present — it only affects the legacy fallback). Add a new `okf.fanout.exclude_legacy` span attribute (and a `retriever.legacy.excluded` INFO log).
- [x] `genie-ai-overlay/tests/test_label_contract.py` -- ADDITIVE EXTEND: 4 new cases (`encode(no_legacy=True)` round-trip; `decode` peels `::no_legacy:`; default `no_legacy=False` produces the pre-extension segment set; the new segment coexists with graphs without interfering).
- [x] `genie-ai-overlay/tests/test_chatqna_fanout_carrier.py` -- ADDITIVE EXTEND: 2 new cases (`exclude_legacy=True` adds the `::no_legacy:` segment to the carrier; `exclude_legacy=False` produces the canonical carrier shape unchanged).
- [x] `genie-ai-overlay/tests/test_fanout.py` -- ADDITIVE EXTEND: 1 new case in `TestFanoutShouldEngage` for the `_exclude_legacy` decode; 1 new case verifying the legacy `ARANGO_GRAPH_NAME` fallback is refused when `_exclude_legacy=True`.
- [x] `components/gov-chat-backend/__tests__/retrieval-config-client.test.js` -- CREATE: 8 mocked cases (cache hit, miss, expiry, okf-server 5xx, okf-server 401, last-known-good, bearer-isolation, no-eviction) -- so the cache seam is contract-pinned.
- [x] `components/gov-chat-backend/__tests__/query-service-fanout.test.js` -- CREATE: 8 cases mapping to the I/O Matrix (LEGACY_DEFAULT, HYBRID_WITH_SERVING, OKF_ONLY_WITH_SERVING, HYBRID_ZERO_SERVING, OKF_ONLY_ZERO_SERVING, UNAUTHORIZED_REPO, BFF_CANNOT_REACH_OKF_SERVER, RETRIEVER_FANOUT_ENABLED=false is opaque to BFF) -- so the BFF's chatqna-payload shape is pinned for every mode/state combination, including the **GRAPH-injection rule (prepend in `hybrid`, omit in `okf_only`)** and the **new `exclude_legacy: true` kwarg in `okf_only` mode**.
- [x] `components/gov-chat-backend/__tests__/e2e-fanout.test.js` -- CREATE: 3 supertest cases (legacy payload byte-identical regression, hybrid payload with the right kwarg shape, bearer-isolation regression) -- so the end-to-end wire-up is asserted from the HTTP request to the chatqna call.
- [x] `components/okf-server/scripts/check-okf-repo.js` -- EXTEND: add Step 5 (retriever end-to-end carrier POST + per-leg contribution assertion) -- so the existing 4-step smoke harness validates the fan-out path live.

**Acceptance Criteria:**
- Given `OKF_RETRIEVAL_MODE=legacy` (boot default, no `okf_system_config` doc) so `/api/okf/retrieval-config` returns `engaged: false`, when the BFF handles a chat request, then the OPEA payload it sends to chatqna is byte-identical to the pre-1-1 payload (same context keys/values, no `authorized_graph_names` kwarg, chatqna's `encode_filter_labels` path runs), the retriever's `_fanout_should_engage` returns `False`, and the legacy `ARANGO_GRAPH_NAME` path executes.
- Given `mode=hybrid` with 2 ingested OKF repos and a caller with read scope on both, so `/api/okf/retrieval-config` returns `engaged: true`, when the BFF handles a chat request, then the OPEA payload carries `authorized_graph_names: ['GRAPH', 'OKF_<a>_v1', 'OKF_<b>_v1']` in the right shape (legacy first, OKF after, per the canonical carrier shape test at `genie-ai-overlay/tests/test_chatqna_fanout_carrier.py:88-90`), the chatqna carrier encodes all three via `encode(..., graphs=...)`, the retriever's `invoke_fanout` runs with 3 legs, and per-hit metadata includes `graph_name` for every result. The `'GRAPH'` element is sourced from `process.env.ARANGO_GRAPH_NAME` (prepended by the BFF, NOT returned by the authz-resolver).
- Given `mode=okf_only` with 2 ingested OKF repos, so `/api/okf/retrieval-config` returns `engaged: true`, when the BFF handles a chat request, then the OPEA payload carries `authorized_graph_names: ['OKF_<a>_v1', 'OKF_<b>_v1']` (NO `'GRAPH'` prepended — the legacy free-form corpus is excluded in `okf_only` mode), the retriever's `invoke_fanout` runs with 2 legs (OKF only), and per-hit metadata shows ONLY the OKF graphs as `graph_name` (no GRAPH hits).
- Given `mode=okf_only` with zero serving graphs, so `/api/okf/retrieval-config` returns `engaged: false` AND `warnings: ['okf_only with zero serving graphs — OKF contribution is zero']`, when the BFF handles a chat request, then the OPEA payload carries `authorized_graph_names: []` AND the new `exclude_legacy: true` kwarg, the chatqna carrier includes the `::no_legacy:` signal segment, the retriever's `ARANGO_GRAPH_NAME` fallback is refused (the legacy corpus is NEVER queried in `okf_only` per the resolved Open Question), the result is zero hits from any graph, AND the BFF records a structured `fanout.warning: "okf_only_zero_serving"` telemetry event consumed by the admin dashboard.
- Given `mode=hybrid` with the okf-server down, when the BFF handles a chat request, then the BFF uses the last-known-good config (defaults to `legacy` if never read), passes `authorized_graph_names: []`, the retriever's legacy path runs, and the BFF logs a WARN with `correlation_id`. The user-visible chat succeeds (fail-closed: never escalates fan-out on config outage).
- Given a caller with read scope on 1 of 3 ingested OKF repos, `mode=hybrid`, `engaged: true`, when the BFF handles a chat request, then the carrier carries `['GRAPH', 'OKF_<authorized>_v1']` only — the unauthorized repos contribute zero hits by construction (the authz-resolver is the isolation boundary; never post-filtering). The `'GRAPH'` is prepended by the BFF (NOT returned by the resolver).
- Given `RETRIEVER_FANOUT_ENABLED=false` on the retriever container, when a chat request reaches the retriever with a non-empty carrier, then the retriever's `_fanout_should_engage` returns `False` and the legacy path runs. The BFF is UNAWARE of this env var — the kill switch is the retriever's, not the BFF's.
- Given any OKF query in the local build today, when the BFF's changes land, then a query against an ingested OKF repo returns at least one result from that repo (the user's "I get no results" complaint is resolved end-to-end).

## Implementation Notes

<!-- Agent-owned. Append-only during implementation. -->

### 2026-10-06 — implementation record (all tasks landed)

1. **The kwargs-channel gap (the one architectural discovery).** The spec
   assumed "chatqna's existing kwarg-handling at chatqna.py:1007-1020 already
   consumes" the BFF's kwargs. Verified against the gateway: `genie_params` is
   built from a HARDCODED dict in `handle_request` (chatqna.py:2593-2600) and
   `ChatCompletionRequest.model_validate(data)` silently DROPS unknown fields —
   an HTTP-body `authorized_graph_names` never reaches `align_inputs` without a
   protocol change. Resolution (honours the "Never: do NOT mutate the Pydantic
   `ChatCompletionRequest`" rule): the carrier rides the application-specific
   `context` object — `RequestContext` (core/genieai_api_protocol.py) gained
   three additive fields (`authorized_graph_names`, `mode`, `exclude_legacy`,
   default `None` = legacy payloads parse byte-identically), and `align_inputs`
   reads them from `retrieval_context` (already forwarded to genie_params)
   FIRST, with the flat `_gp(kwargs, ...)` paths kept as fallbacks — so every
   existing mocked test (`genie_params={"authorized_graph_names": [...]}`)
   passes unchanged. The top-level ChatCompletionRequest surface is untouched.
2. **`decode()` kept its 3-tuple signature.** A 4-tuple would break every
   existing unpack (test_label_contract, retriever, decode_filter_labels shim),
   violating "existing test bodies pass unchanged". Added `_decode_all()` (full
   parse, general order-insensitive multi-marker scan) + public
   `decode_no_legacy(search_start) -> bool` accessor, parallel to the existing
   `decode_filter_labels` shim pattern.
3. **`::no_legacy:` carries a value (`true`/`false`), matching the
   labels/graphs segment pattern.** A bare marker would corrupt the peel: the
   marker match consumes the next segment's leading `::` (e.g.
   `chunk::no_legacy::graphs:A` partitions to a `:graphs:A` remainder the
   parser cannot see). Value-bearing segments partition cleanly.
4. **`no_legacy` is only forwarded to `encode()` when true.** The existing
   chatqna test mocks define `fake_encode(base_mode, labels=None, graphs=None)`
   — an unconditional kwarg would TypeError them. The labels-only
   `encode_filter_labels` legacy surface is preserved verbatim (and the
   exclusion flag routes around it so okf_only + filter-labels still encodes
   `::no_legacy:`).
5. **Retriever: the legacy fallback tail is extracted into
   `_legacy_single_graph_or_refuse()`** (byte-identical statements) so the
   refusal contract is unit-testable without a live DB. `okf.fanout.exclude_legacy`
   is set on the `retriever.hybrid_search` span right after decode (both paths
   carry it); the refusal logs `retriever.legacy.excluded` at INFO and returns
   `[]`.
6. **401 is never cached in the BFF client.** A refreshed token of the same
   caller shares the `(effective_scopes, ttl_window)` key — a cached 401 would
   lock them out until the window rolls. 401 throws typed
   (`OkfAuthzUnauthorizedError`, `statusCode: 401`), uncached; 403 → legacy
   default (no okf scopes ⇒ empty per-caller serving view by construction);
   5xx/network → last-known-good, else the legacy default. The client shape-gates
   the config response (`config.mode` string + `engaged` boolean) — a garbled
   body degrades to the legacy default instead of reaching the carrier logic.
7. **`routes/query-routes.js` (one additive branch, not in the Code Map).**
   Required by the frozen I/O matrix (BEARER_TOKEN_EXPIRED: "BFF surfaces the
   same 401 to the chat client; legacy path is NOT silently engaged"): the
   stream route's catch now honours `error.statusCode === 401` before its
   500/504 fallbacks.
8. **docker-compose.yaml: one additive backend env entry** —
   `OKF_SERVER_URL` (default `http://okf-server:3002`, the code default matches
   the dataprep's existing entry). Present so operators can override without an
   image rebuild; no root `env` change (by design, same rationale as
   `RETRIEVER_FANOUT_ENABLED`).
9. **Test counts landed: 28 new backend tests** (13 client + 12 carrier/payload
   + 3 e2e — the spec estimated 8+8+3=19; the extra cases pin 403→legacy,
   malformed-body, scope-order equivalence, super-admin keying, ARANGO_GRAPH_NAME
   override, unexpected-error fail-closed, no-bearer skip, and 401 propagation),
   9 new Python tests (4 label-contract + 2 chatqna carrier + 3 retriever
   fan-out — the third pins the not-excluded fallback still targets
   ARANGO_GRAPH_NAME). Full suites: backend 228 query-related green (5 unrelated suites
   fail identically on the clean baseline — local env, shared/lib node_modules);
   OPEA 864 passed (5 pre-existing Windows-local failures in
   test_trace_logging/test_docarray_shim, identical on baseline); okf-server
   747 passed.
10. **Docs gate (amendment H):** `site/content/en/docs/architecture/opea-microservices.md`
    §6.1 "The Multi-Graph Fan-Out Carrier" added. No i18n surface touched
    (backend/protocol only — no user-visible strings).

### 2026-10-06 — review round 1 fixes (append-only)

11. **createQuery (non-stream) now attaches the carrier** — same
    `_attachFanoutCarrier` call as the stream path (401 propagates, no-bearer
    skips, fail-closed); pinned by 2 new createQuery cases in
    query-service-fanout.test.js (hybrid + okf_only shapes at the
    runOPEAWorker boundary). 12. Parse-boundary pin: test_core.py asserts the
    exact BFF wire body survives `ChatCompletionRequest.model_validate` →
    `context.model_dump(exclude_unset=True)` with all three carrier fields.
    13. Routing-term pin: align_inputs with labels + exclude_legacy and NO
    graphs takes the combined encode (encode_filter_labels never called).
    14. invoke()-level refusal pin: `search_start="chunk::no_legacy:true"` →
    [] with `_extract_for_graph` never invoked (test_retriever.py, invoke_env
    harness). 15. check-okf-repo.js Step 5: `res.json()` wrapped separately
    (FAIL "non-JSON 200 body" instead of the misleading "unreachable"); an
    okf_only refusal probe added using the EMPTY-carrier string
    `chunk::no_legacy:true` — with a live OKF graph in the carrier the fan-out
    legitimately returns OKF hits and a zero-hit assertion would fail on
    healthy deployments; the empty carrier is the only shape whose contract is
    "zero hits when the refusal holds" (and it 400s on a pre-1.1 decoder).
    16. compose passes ARANGO_GRAPH_NAME to the backend (default GRAPH)
    beside OKF_SERVER_URL. 17. _attachFanoutCarrier docstring: the
    engaged-false okf_only bullet now states the refusal (zero hits).
    18. §6.1 qualified (config outage → fail-closed to legacy posture) + the
    two-call/≤30s-cache latency note. 19. Client: envPositiveInt warns with
    variable/value/fallback; module docstring states last-known-good is
    posture-only (per-caller graphs always live); `crypto.randomUUID()` →
    `nodeCrypto.randomUUID()` (consistent with the existing alias).
11. **Orchestrator verification pass (2026-10-06, post-diff-review).** Three
    first-hand findings from the step-03 diff audit, all fixed:
    (a) `retrieval-config-client.js` called `crypto.createHash` on Node's
    GLOBAL webcrypto (no `createHash` there) — the undecodable-token cache-key
    fallback would have thrown `TypeError` at runtime. Fixed with
    `const nodeCrypto = require('crypto')` + renamed call site (the global
    `crypto` is kept for `randomUUID`); pinned by a new client test
    ("undecodable bearer: the token-hash fallback key works").
    (b) The BEARER_TOKEN_EXPIRED I/O row's route-level hop (query-routes 401
    branch) had no covering test — added a 4th e2e case asserting HTTP 401 +
    `{error: 'UNAUTHENTICATED'}` + chatqna NEVER called (no silent legacy
    engagement).
    (c) Re-ran the covering tests first-hand: 30/30 new backend tests green
    (14 client + 12 payload + 4 e2e), 281/281 across
    test_label_contract/test_chatqna_fanout_carrier/test_fanout/test_chatqna
    (the legacy byte-identical pin included). ESLint + Prettier clean on all
    touched backend files.
20. **Post-review-verification tweak (orchestrator).** `envPositiveInt` warned
    even when the env var was simply UNSET (the normal default path) — two
    spurious boot WARNs per service would train operators to ignore them. The
    warn now fires only for PRESENT-but-invalid values; unset falls back
    silently. Verified: eslint/prettier clean, 32/32 story suites green after
    the tweak. One deviation in patch item 5 was the implementer's CORRECTION
    of my instruction: the okf_only smoke refusal probe posts
    `chunk::no_legacy:true` (empty carrier) rather than
    `chunk::graphs:<OKF>::no_legacy:true` — with a live graph in the carrier
    the fan-out legitimately returns OKF hits (no_legacy governs only the
    FALLBACK), so the empty carrier is the only zero-hit-valid shape.

## Spec Change Log

<!-- Append-only. Empty until first bad_spec loopback. -->

## Review Triage Log

<!-- Append-only. Populated by the step-04 review pass (2026-10-06, loop 0). -->
<!-- Note: the step-04 diff file briefly contained only the diffstat (orchestrator
     error writing it); all three layers reconstructed the full diff from the
     working tree and verified it byte-matches the staged state before reviewing. -->

- **[VG-1] wire-seam round-trip unpinned** (`genie-ai-overlay/core/genieai_api_protocol.py`) — **medium → patch** (pre-verified by the verification-gap layer). Nothing asserts the BFF's carrier fields survive `ChatCompletionRequest.model_validate` → `context.model_dump(exclude_unset=True)` into `retrieval_context`; a field rename on either side silently disables the entire fan-out (Pydantic drops unknown keys) with every test green — each side is tested against its own local fixture.
- **[VG-2] labels-only × exclude_legacy routing unpinned** (`genieai_chatqna.py:1016`) — **medium → patch** (pre-verified). The `and not _exclude_legacy` term that keeps labelled okf_only chats encoding `::no_legacy:` is exercised by no test (existing exclusion fixtures carry no label fields); reverting the term reintroduces a legacy-corpus leak with zero failures.
- **[VG-3] invoke()-level decode→refusal chain unverified** (`genieai_retriever_arangodb.py`) — **medium → patch** (pre-verified, grouped with BH-9). The refusal is only tested with `exclude_legacy` handed in as a direct argument; no test executes `invoke()` with a `::no_legacy:` carrier string, and smoke Step 5 probes only the hybrid shape — the production string→refusal wiring could break silently.
- **[VG-4] createQuery never attaches the carrier** (`query-service.js:588`, route `POST /api/queries`) — **medium → patch** (pre-verified; grouped with EC-4/BH-5). Verified in-code: `_attachFanoutCarrier` is called only at query-service.js:442 (initStreamQuery); createQuery builds its payload at :765-793 without it, so okf_only through the non-stream route queries the legacy free-form corpus — violating the frozen okf_only rule the docs added. Both first-party UIs use /queries/stream, but the route is registered and exposed in the mobile OpenAPI client. The frozen intent admits exactly one reading (rule 3 is absolute), and the fix reuses the demonstrated method → patch, not intent_gap.
- **[EC-1] concurrent same-scope cache misses race** (`retrieval-config-client.js`) — **low → rejected**. Real mechanically (last completion wins the cache set; a late 5xx can overwrite a good entry), but it needs two concurrent same-caller requests straddling a failure, the consequence is a ≤30s self-healing legacy-degraded posture (fail-closed direction), and the fix (in-flight promise memoization) adds machinery beyond a direct correction.
- **[EC-2] non-object JWT payload collapses cache keys** (`retrieval-config-client.js:75-87`) — **false**. The only production caller path passes Keycloak-verified tokens (route middleware authenticates before query-service); a verified JWT payload is a claims object, so `decodeJwtPayload` returning a non-object is unreachable there — the unparsed fallback is defense-in-depth for tokens that cannot occur post-verification.
- **[EC-3] Step 5 mislabels a non-JSON 200 as "retriever unreachable"** (`check-okf-repo.js`) — **low → patch**. `res.json()` on an HTML/empty 200 body throws into the catch whose message names network unreachability; the harness still fails loudly but sends the operator to the wrong layer. Fix: its own try/catch with an explicit FAIL record.
- **[EC-4] createQuery claim (edge-case layer)** — **medium → patch**, same finding as VG-4 (Group A).
- **[EC-5] hybrid zero-serving payload not byte-identical** — **false**. The code follows the HYBRID_ZERO_SERVING matrix row verbatim ("passes empty `authorized_graph_names`"); byte-identity is pinned — and tested — only for mode=legacy, where the code adds nothing (both facts asserted by the new tests, which pass). The residual tension is between two frozen spec sentences; its fix would edit the frozen block, which is out of bounds for this loop.
- **[EC-6] okf_only_zero_serving warning not in chat response metadata** — **false**. The code follows the row's governing cell ("consumed by the admin dashboard, NOT surfaced to the user chat") — `logger.warn` with the structured `fanout.warning` payload is that telemetry channel (fluentd → VL → admin). The "chat response metadata" phrasing lives in the row's error-handling cell; reconciling it would edit the frozen block.
- **[BH-4] ARANGO_GRAPH_NAME not plumbed to the backend container** (`docker-compose.yaml`) — **medium → patch**. Compose passes it to dataprep + retriever only; an operator overriding it in `.env` diverges the BFF's hybrid legacy leg ('GRAPH' hardcoded fallback) from the retriever's actual legacy graph — silent empty legacy leg, no error. Fix: one additive env entry beside OKF_SERVER_URL.
- **[BH-6] `_lastGoodConfig` shared across callers** (`retrieval-config-client.js`) — **low → patch (docstring only)**. Verified the response IS per-caller (`retrieval-config-service.js:171-184` — serving set filtered by caller scopes), but traced all four mode×scope cells: the graph set always comes from the caller's own live authz call, and `engaged:true` + a fail-closed authz degrades to exactly the caller's correct posture (in okf_only, zero-hits matches the caller's true zero-serving outcome better than the legacy default does). No user-visible divergence and no isolation breach → behavior stands; a one-line docstring note (LKG is posture-only, graphs always per-caller live) closes the developer-facing gap.
- **[BH-7] docs' absolute "NEVER queried" vs the outage legacy default** (`opea-microservices.md` §6.1) — **low → patch**. The runtime behavior is the frozen spec's explicit prescription (unreachable → legacy default is listed inside the legacy-byte-identical case; BFF_CANNOT_REACH_OKF_SERVER row), so the code stands; but the doc sentence this diff ADDED ("NEVER queried, engaged or not") overstates it. Fix: qualify with the config-outage exception.
- **[BH-8] stale docstring bullet in `_attachFanoutCarrier`** (`query-service.js:461-462`) — **low → patch**. "engaged == false AND mode ∈ {hybrid, okf_only} → retriever stays on the legacy path" is wrong for okf_only (the carrier sets exclude_legacy and the retriever refuses — zero hits). Code is right; reword the bullet.
- **[BH-9] smoke harness has no okf_only probe** — **low → patch**, grouped with VG-3 (same root: the refusal chain unverified at the live boundary).
- **[BH-11] `envPositiveInt` silently swallows misconfiguration** (`retrieval-config-client.js:33-37`) — **low → patch**. An operator typo (`OKF_RETRIEVAL_CONFIG_TTL_MS=500` → 30000) never surfaces; the repo's verbose-logging rule wants a warn naming the variable, value, and applied fallback.
- **[BH-12] worst-case added chat latency undocumented** — **low → patch** (folded into the BH-7 docs edit). Cache miss with a slow-but-alive okf-server adds up to two sequential ≤3s upstream calls before chatqna; one sentence in §6.1 records the budget.
- **[BH-1] step-04 diff file contained only the diffstat** — **false** as a change-finding. Harness artifact of the orchestrator's regeneration command; all three layers independently reconstructed the diff and verified it byte-matches the staged state (17 files, +1911/−76); the file has been regenerated in full.
- **[BH-2] unstaged files outside the review** — **false** as a change-finding. `.serena/project.yml` predates the baseline (tooling noise); the unstaged spec delta is this step's own status flip; both are staged at commit time.
- **[BH-3] `.claude/dora.json` untracked, not gitignored** — **defer** (pre-existing before this story's baseline commit; repo hygiene, not caused by this change).
- **[BH-10] `ttl_seconds` documented but not consumed** — **false**. Documenting a response field is not committing to consume it; the fixed `OKF_RETRIEVAL_CONFIG_TTL_MS` window is the spec-pinned cache design.
- **[BH-13] no CHANGELOG [Unreleased] entry** — **false**. The repo's release flow (`.claude/rules/RELEASE.md`) writes CHANGELOG entries during release prep on main; feat/okf-server story branches do not carry [Unreleased] entries — consistent with every prior OKF story on this branch.
- **[Edge-other] Step 5 zero-contribution leg is WARN not FAIL** — **false**. Explicit deliberate semantics; the record message states the reason inline.

**Grouping:** Group A = VG-4+EC-4+BH-5 (createQuery carrier adoption); B = VG-1 (wire-seam round-trip test); C = VG-2 (labels×exclusion routing test); D = VG-3+BH-9 (invoke-level refusal chain: test + smoke probe); E = BH-4 (compose env plumb); F = BH-8 (docstring bullet); G = BH-7+BH-12 (docs qualification + latency note); H = BH-11 (envPositiveInt warn); J = EC-3 (Step 5 JSON guard). Rejected/defers stand alone. **No intent_gap, no bad_spec → no loopback.**

## Design Notes

The BFF is the correct place for this wire-up because chatqna is a service consumer (not a service integrator), and the authz-resolver service is already the server-side source of truth for token→{graph_names, per_graph_labels, domains}. Putting the integration in the BFF (1) keeps chatqna's contract narrow (kwargs in, search_start out), (2) keeps the okf-server endpoints in the trusted side, and (3) gives a single integration point that can be tested in isolation with supertest + mocked okf-server.

The carrier (`search_start` `::graphs:` segment) is the single source of truth for the retriever's engagement decision per 1-0 Decision D. The retriever does not need to change — it already reads the carrier, calls `_fanout_should_engage`, and routes to `invoke_fanout` if and only if the carrier carries ≥1 graph. The legacy path is the safety floor (D8 invariant).

## Verification

**Commands:**
- `cd components/gov-chat-backend && npm test` -- expected: all existing 719+ tests pass unchanged (legacy payload shape pinned), plus the 18 new tests (8 + 7 + 3) added by this story pass.
- `cd components/gov-chat-backend && npx eslint services/retrieval-config-client.js services/query-service.js __tests__/retrieval-config-client.test.js __tests__/query-service-fanout.test.js __tests__/e2e-fanout.test.js` -- expected: clean.
- `cd components/gov-chat-backend && npx prettier --check services/retrieval-config-client.js services/query-service.js __tests__/retrieval-config-client.test.js __tests__/query-service-fanout.test.js __tests__/e2e-fanout.test.js` -- expected: clean.
- `cd components/okf-server && npm test` -- expected: 677+ existing tests + the 4-8 + 7-7 + 6-1b tests pass; `retrieval-config-routes.test.js` is the canonical contract pin for the endpoints this spec depends on.

**Manual checks (local build, after the wire-up lands):**
- Confirm the BFF in the local stack can reach the okf-server `/api/okf/retrieval-config` endpoint (Docker network between `gov-chat-backend` and `okf-server` containers).
- With `OKF_RETRIEVAL_MODE=hybrid` and ≥1 ingested OKF repo: issue a curl POST to `/api/me/chat` (the BFF chat route) with a query against the OKF repo; assert the response includes at least one `source_documents` entry with a `graph_name` matching the OKF repo AND at least one entry with `graph_name == 'GRAPH'` (proves the legacy-prepend rule).
- With `OKF_RETRIEVAL_MODE=okf_only` and ≥1 ingested OKF repo: same query; assert the response includes entries with the OKF graph name but **ZERO** entries with `graph_name == 'GRAPH'` (proves the GRAPH is excluded in `okf_only`).
- With `OKF_RETRIEVAL_MODE=legacy`: same query; assert the response is byte-identical to the pre-1-1 response for the same query (regression guard — the chatqna `encode_filter_labels` path runs, the carrier is empty, no `authorized_graph_names` kwarg).
- With `mode=hybrid` AND 0 ingested OKF repos: same query; assert the response includes ONLY entries with `graph_name == 'GRAPH'` (the legacy path ran because the server's `engaged: false`).
- With `mode=okf_only` AND 0 ingested OKF repos: same query; assert the response is **zero hits from any graph** (the new `exclude_legacy: true` signal refused the legacy fallback; `okf_only` literally means OKF only per the resolved Open Question). Verify the BFF telemetry includes the `fanout.warning: "okf_only_zero_serving"` event.
- Confirm `RETRIEVER_FANOUT_ENABLED=false` on the retriever container (via docker exec env) overrides any BFF behavior — legacy path runs even with a non-empty carrier; the BFF's payload is unchanged (it doesn't read this env var).
