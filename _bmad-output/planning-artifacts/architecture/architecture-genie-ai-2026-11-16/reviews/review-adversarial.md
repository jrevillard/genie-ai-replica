---
lens: adversarial
target: ../ARCHITECTURE-SPINE.md
reviewer: finalize-reviewer (adversarial lens)
date: 2026-11-16
verdict: REVISE
severity: 4 high, 6 medium, 0 critical
---

# Adversarial review — two compliant builders, incompatible systems

## Method

The units one level down are the builders the spine will be extracted into:
the S3 contract implementer (`capabilities/`), the S4 loop implementer
(`agent/`), the BFF chat/activation integrator (`components/gov-chat-backend`),
the eval-harness builder (config B), the CI-gate writer
(`tests/config-validator/`), the rollback/rehearsal engineer, the obs
implementer, and the deployment packager (compose + chart). For each pair I
constructed a scenario where **both units obey every AD and convention to the
letter** and the composed system still breaks: clashing shared-data shapes,
two owners of one entity, conflicting state-mutation paths, ambiguous
boundaries. A pair only counts as a hole if the spine text as written does
not already forbid it — the AD checked is quoted in each finding.

Pairs attacked and found **already covered** (no finding): two writers to the
`queries` collection (AD-12 pins "BFF, unchanged"); the port calling vLLM
(diagram rule: "the port never calls vLLM"); `search_start` compression
leaking into the port (convention: "Never the `search_start` compressed
string"); agent-path code inside `genie-ai-overlay/` (AD-1 rule sentence 1);
per-request vs per-user activation drift (AD-9: "One deployment-level flag");
budget-exempt auxiliary calls (AD-6: "Everything counts").

---

## ADV-1 — The grounding verdict and correction event have no defined position in the terminal SSE sequence

- **Severity:** high
- **Units:** S4 finalize/grounding-verifier builder (agent-service) × BFF SSE
  integrator + frontend activity-line builder.
- **Scenario:** Iteration 1 ships `verdict-marked`: text streams normally,
  the judge runs at finalize, and on failure a verdict + explicit correction
  event must reach the user. Builder A (agent-service) emits the verdict and
  correction as new additive events immediately **after** `done` — the stream
  is finished, the frame order of the five legacy types is untouched, the new
  types are "additive, explicitly versioned". Builder B (legacy-behaving
  client, e.g. the mobile app on the preserved contract) treats `done` as
  terminal and closes the connection, which AD-8 explicitly permits
  ("ignored by clients that don't know them"). The correction is never
  rendered: the policy's "never silent" guarantee is silently dropped for
  exactly the clients the compatibility contract protects. Alternatively
  Builder A holds `done` until the judge returns (a budgeted LLM call —
  seconds): every response's terminal timing changes, and the interaction
  with `[translation]` (verdict before or after the flip?) is undefined —
  Builder A and the e2e envelope spec (`stream-route.js`) can pin opposite
  orders.
- **ADs checked (quoted):**
  - AD-8: "The five client event types (`chunk`, `metadata`, `translation`,
    `done`, `error`) and the terminal order chunks → metadata → [translation]
    → done are preserved verbatim." — preserves the order of the five types;
    says nothing about where **new** types may sit relative to `done`.
  - AD-8: "New event types … are additive, explicitly versioned, and ignored
    by clients that don't know them." — permits post-`done` emission and
    permits clients to ignore the correction.
  - AD-7: "a judged check at finalize (one budgeted call …) … iteration 1
    ships `verdict-marked`: stream normally, verdict + explicit correction
    event on failure, persisted marking — never silent." — requires the
    events exist and be non-silent, but not when they are emitted or whether
    `done` awaits the verdict.
- **Tightened AD (proposal):** Extend AD-7: "In `verdict-marked`, `done` is
  not emitted until the grounding verdict is decided; verdict (and, on
  failure, correction) events are emitted in the window after the last
  `translation` frame and before `done`, and `done` carries the verdict as a
  field; no verification-outcome event is ever emitted after `done`."

## ADV-2 — Two owners of the end-to-end wall clock: orchestrator deadline vs BFF upstream timeout

- **Severity:** high
- **Units:** BFF integrator wiring the agent-service upstream call × S4
  request-orchestrator owner.
- **Scenario:** The BFF already has upstream-call timeouts on the chatqna leg.
  The BFF integrator reuses them for the agent-service call — nothing in the
  spine tells them otherwise. The orchestrator owner sets the end-to-end
  wall-clock deadline per AD-6 (numerics post-baseline, plausibly longer than
  the legacy chat timeout). A healthy agent run of 90 s under a 60 s BFF
  timeout: the BFF aborts a run the orchestrator considered in-budget; the
  client sees a legacy `error` frame; the orchestrator records an aborted
  upstream; CM-3 ("rate of executions hitting execution limits or
  cancellation") counts a limit-hit that is actually a misconfigured BFF
  socket timer. Rollback rehearsal (V08) shows spurious failures. Both
  builders fully comply: AD-6 assigns the deadline to the orchestrator and
  defines cancellation **only** for client disconnect; no AD constrains the
  BFF's timeout on the agent leg.
- **ADs checked (quoted):**
  - AD-6: "A per-request orchestrator in agent-service owns: step cap,
    end-to-end wall-clock deadline, per-run token budget, model/tool-call
    count, evidence volume." — ownership stated for agent-service only.
  - AD-6: "Cancellation chain: BFF detects client disconnect on the stream
    (replacing the dead `req.on('close')` path) → aborts the upstream call →
    agent-service cancels the in-flight model call." — the only BFF-initiated
    abort defined is disconnect-driven.
- **Tightened AD (proposal):** Extend AD-6: "The orchestrator's end-to-end
  deadline is the sole wall-clock bound on an agentic request. The BFF's
  upstream call carries no timeout shorter than the maximum configured
  orchestrator deadline plus slack; BFF-initiated aborts are distinguished
  from client disconnects in the error frame and in CM-3 accounting."

## ADV-3 — The AD-11 execution-record has no defined carrier from agent-service into the BFF-written `queries` doc

- **Severity:** high
- **Units:** agent-service obs/execution-record builder × BFF persistence
  writer.
- **Scenario:** AD-11 requires every execution's implementation/model/prompt/
  configuration versions to be recorded "in the `queries` doc metadata + trace
  attributes". AD-12 pins the writer: "`queries` collection per turn (BFF,
  unchanged)". The BFF knows its own versions, not the agent's model, prompt
  and configuration ids. Builder A (agent-service) puts the versions in trace
  attributes and a new field on the `done` frame; Builder B (BFF, writing the
  doc "unchanged") persists only what the legacy `metadata` handler knows.
  Result: the `queries` doc lacks the record AD-11 mandates, or carries it in
  a field analytics never reads — the FR-17 investigation chain ("sufficient
  to investigate that execution") is broken while both builders comply. Note
  also the latent wording split: AD-9 says "The agentic path mints a
  `queries`-collection doc" while AD-12 says the BFF writes it — read
  together the BFF mints on behalf of the path, but then the agent→BFF
  version channel is exactly the undefined seam, and AD-9's "same shape"
  cuts against adding fields.
- **ADs checked (quoted):**
  - AD-11: "Every execution records implementation/model/prompt/configuration
    versions (in the `queries` doc metadata + trace attributes)…" — names the
    destination, not the transport.
  - AD-12: "The agentic path writes only through the existing shapes:
    `queries` collection per turn (BFF, unchanged)…" — writer pinned,
    agent-supplied content unspecified.
  - AD-8: the five event types and their order are preserved verbatim; the
    agent path's `metadata`-frame **payload** is nowhere specified (see also
    ADV-10).
- **Tightened AD (proposal):** Extend AD-11 (or the conventions): "The agent
  path's `metadata` frame carries a versioned `execution_record` block
  (implementation/model/prompt/configuration ids); the BFF persists it
  verbatim into the `queries` doc metadata; the block's field names are part
  of the additive-versioned SSE contract and of the doc shape contract for
  the agentic path."

## ADV-4 — Config B as "direct single-pass port call" bypasses the admission-control and cancellation the orchestrator owns — contaminating the E02 attribution

- **Severity:** high
- **Units:** eval-harness builder (config B) × agent-service builder
  (orchestrator, lane-cap semaphore).
- **Scenario:** AD-10 defines config B as "a no-agent mode of the same
  service: direct single-pass port call, same budgets". The harness builder
  implements exactly that: an entry point that calls the port directly,
  skipping the request orchestrator — the component AD-6 makes the owner of
  budgets, **and separately** of the admission-control semaphore and the
  cancellation chain. Under concurrent evaluation load (A, B and C runs share
  vLLM/TEI with live chat), B runs contend unthrottled while C runs queue on
  the lane cap: the measured B/C latency and resource deltas (M-4/M-5, E02)
  reflect admission policy, not the agent. That breaks the PRD's core claim
  the spine re-states: "so the E02 delta attributes to the agent". "Same
  budgets" does not close it — AD-6 lists admission control as a distinct
  ownership from the five budget dimensions.
- **ADs checked (quoted):**
  - AD-10: "Evaluation config B … = a no-agent mode of the same service:
    direct single-pass port call, same budgets — B and C share the retrieval
    backend exactly…" — "same budgets" enumerated nowhere to include
    admission; "direct" reads as orchestrator-bypassing.
  - AD-6: "Admission control against shared vLLM/TEI: a lane-cap-style
    concurrency bound (env-configured semaphore …); saturation behavior
    defined before S4." — admission is the orchestrator's, and nothing pulls
    config B through it.
- **Tightened AD (proposal):** Extend AD-10: "Config B enters through the
  same request orchestrator as config C — admission semaphore, cancellation
  chain, budget accounting, tracing included; 'no-agent' replaces only the
  loop with a single fixed pass over the port."

## ADV-5 — The CI gate's "agent-path packages" does not cover the BFF leg of the agentic request path; translation ownership falls in the gap

- **Severity:** medium-high
- **Units:** CI-gate writer (`tests/config-validator/`) × BFF integrator ×
  agent-service builder (translation).
- **Scenario:** FR-20 binds "the agentic **request path**": when the flag is
  ON, the BFF leg is part of it. AD-1's enforcement text, however, fails the
  pipeline on `comps`/OPEA imports "in **agent-path packages**" — undefined,
  and naturally read by the gate writer as the new packages
  (`components/agent-service/**`). The BFF integrator wires the flag-ON leg
  reusing existing code that calls an OPEA-built service (the concrete case:
  streaming/non-streaming translation, today served by the OPEA translation
  stack — AD-8 requires "Translation compatibility carries over in both
  modes", which the integrator satisfies by keeping the existing mechanism).
  Both comply with AD-1 as written; the shipped flag-ON request path violates
  FR-20. The mirror gap: the spine never assigns **who owns translation on
  the agentic path**. AD-6's budget list ("auxiliary model calls
  (translation, classification, the grounding judge)") implies agent-service
  does it via vLLM — the only model edge the diagram grants the loop
  ("LOOP --> V") — but no AD states it, so the agent-service builder can
  equally read "carries over" as "someone else's problem" and ship without
  it. One gap, two incompatible compliant outcomes (OPEA translation on the
  BFF leg vs vLLM translation in the loop — or neither).
- **ADs checked (quoted):**
  - AD-1: "CI gate (new `tests/config-validator/` test …) fails the pipeline
    on `comps`/OPEA imports or OPEA build-time downloads in agent-path
    packages, from the first delivered stage." — package set undefined; the
    BFF is not an OPEA-*importing* package in any case the gate can grep.
  - Diagram rules: "nothing inside agent-service imports `comps` or calls an
    OPEA-built service; the frontend never talks to anything but the BFF." —
    scoped to *inside agent-service* and the *frontend*; the BFF→OPEA edge on
    the flag-ON leg is absent from the diagram (flag-OFF edge only), but a
    diagram's edge-set is not a greppable gate.
  - AD-8: "Translation compatibility carries over in both modes (translated
    units as `chunk` frames when streaming translation is on;
    `done.translationFailed` semantics preserved)." — the frame contract
    without an owner.
- **Tightened AD (proposal):** Extend AD-1: "agent-path packages =
  `components/agent-service/**` plus the named BFF modules reachable on the
  flag-ON leg; the gate also fails on any BFF→OPEA-built-service call on
  that leg." Extend AD-6 or AD-8: "Translation on the agentic path is owned
  by agent-service (vLLM translation model, LOOP→V edge), never by an
  OPEA-built service; its streaming and flip modes map onto the preserved
  `chunk`/`done.translationFailed` contract."

## ADV-6 — The runtime seam's internal event envelope and the internal→BFF translation have no single owner

- **Severity:** medium
- **Units:** runtime-adapter builder (custom loop now; pydantic-ai/DSH at the
  D03 swap) × `agent/` event-shaping and `app/` host builder.
- **Scenario:** AD-5(b) has runtimes plug onto "an internal event stream
  shaped on the AG-UI taxonomy"; AD-8 has "agent-service emits the BFF's JSON
  event dialect directly". Two compliant readings: (1) the runtime emits
  AG-UI-shaped internal events and `agent/` event shaping translates them to
  the BFF dialect; (2) "directly" means the loop itself emits BFF frame
  names and no internal stream exists in iteration 1. Builder A (custom
  loop) takes reading 2 — emits `chunk`/`agent_activity` from inside the
  loop; Builder B (host/shaping) takes reading 1 — wraps everything through a
  normalizer. If both build, frames are double-shaped; if the D03 swap later
  brings a runtime built on reading 1 into a reading-2 pipeline, its
  AG-UI-shaped events are never translated (or vice versa). The spine also
  does not define the internal envelope — run id, tool-call id, sequence,
  ordering/backpressure — so two runtime adapters can comply with "shaped on
  the AG-UI taxonomy … pattern, not dependency" and still disagree on
  identity and ordering, which is precisely what the correction/verdict and
  activity events of ADV-1/ADV-7 need to correlate.
- **ADs checked (quoted):**
  - AD-5: "(b) an internal event stream shaped on the AG-UI taxonomy (run
    lifecycle, text deltas, tool-call lifecycle, state — pattern, not
    dependency)". — "pattern, not dependency" leaves the envelope free.
  - AD-8: "agent-service emits the BFF's JSON event dialect directly (the
    bytes-repr dialect dies with chatqna)." — "agent-service" (the service)
    vs the runtime (a plug-in part of it) is the ambiguity.
  - Structural seed: `agent/` contains "event shaping"; `app/` is "event
    stream out" — placement exists, ownership of the translation is not
    stated.
- **Tightened AD (proposal):** Extend AD-5: "The internal event stream is the
  only interface a runtime may implement: an envelope (run_id, call_id, seq,
  kind, payload) owned by `agent/` event shaping. The internal→BFF-dialect
  translation table lives in exactly one module, is versioned with the SSE
  envelope spec, and runtimes never emit BFF frame names."

## ADV-7 — `agent_activity` operation names are not contract-owned; every D03 swap churns the user-visible vocabulary

- **Severity:** medium
- **Units:** S3/S4 tool-registry builder × frontend activity-line builder and
  e2e envelope spec.
- **Scenario:** AD-8's `agent_activity` carries "tool-call started/completed
  + operation name". AD-5(a) has tools as "server-registered tool
  definitions". The custom loop registers `search_knowledge`/`read_source`;
  a pydantic-ai swap derives tool names from Python function names; a DSH
  subprocess names tools per its plugin registry — all compliant. The
  frontend's minimal activity line and the pinned e2e envelope spec then
  literal-match names that change with the runtime — the swap AD-5 exists to
  make cheap becomes a client-contract break. Second half of the gap: AD-6
  lists "auxiliary model calls (translation, classification, the grounding
  judge)" — are these tools with activity events? The judge firing
  "judging…" into the user's activity line (or not) is undefined; two
  compliant builders ship opposite user-visible behavior.
- **ADs checked (quoted):**
  - AD-8: "New event types (iteration 1: `agent_activity` — tool-call
    started/completed + operation name, no raw reasoning)". — the name
    source and vocabulary are unspecified.
  - AD-5: "(a) server-registered tool definitions" — registration location
    stated, naming ownership not.
  - Conventions: "capability ops `search_knowledge`, `read_source` (working
    names, versioned at contract acceptance)" — versioning is deferred to S3
    (D04) for the port, and nothing extends it to the activity vocabulary.
- **Tightened AD (proposal):** "The activity-name vocabulary is
  contract-owned: a closed, versioned mapping from registered tool ids to
  user-facing operation names; tools not in the mapping emit no activity
  event (grounding judge, translation, classification are silent); the
  mapping is part of the additive SSE contract, independent of the runtime."

## ADV-8 — `read_source` gets two enforcement semantics in one turn: live downstream validation vs request-scoped graph-set membership

- **Severity:** medium
- **Units:** S3 executor implementer × okf/doc-repo adapter implementer × BFF
  trusted-context assembler.
- **Scenario:** Per the conventions, "Bearer tokens are forwarded only where
  a downstream service enforces its own validation (okf-server, doc-repo)" —
  so `read_source(file_id)` hits doc-repo's **live** authorization. Per
  AD-3, concept reads are enforced "by construction" against the
  **request-scoped** authorized graph set the BFF assembled at request
  start. Mid-request revocation: the file read is refused (live check), the
  concept read succeeds (stale set) — one turn, one user, two enforcement
  semantics. FR-28/AD-4 scope the permission-change concern to "between
  turns before retained evidence is reused", leaving within-request
  divergence unstated; both builders comply with their quoted rules, and
  eval config B inherits whichever mix its entry point happens to exercise.
- **ADs checked (quoted):**
  - AD-3: "The port receives the per-request **trusted caller context**
    (user id + resolved authorized graph set …) already assembled by the BFF,
    and queries **only** that set: enforcement by construction." —
    request-scoped semantics for the port.
  - Conventions: "Bearer tokens are forwarded only where a downstream
    service enforces its own validation (okf-server, doc-repo)." — live
    downstream semantics, coexisting without a stated precedence.
  - AD-4: "…cross-user and between-turns permission-change attempts are
    tested". — between-turns only.
- **Tightened AD (proposal):** State one semantics: "All port-operation
  authorization decisions resolve against the single request-scoped
  authorized set; downstream live re-validation must not widen or narrow
  access mid-request (a refused downstream read surfaces as an operation
  error, not as a narrowing of the set), and within-request revocation takes
  effect next turn — recorded as the FR-28 product-policy default."

## ADV-9 — The one-flag guarantee is a compose mechanism; the spine claims both venues but does not carry it into the chart

- **Severity:** medium
- **Units:** deployment packager (k3s chart venue) × BFF/compose integrator.
- **Scenario:** The structural seed says "Deployment shape (both venues:
  Swarm compose and k3s chart) … replicas gated by the activation flag". In
  compose, the `OKF_ENABLED` pattern gives one env var driving both
  `replicas: ${FLAG}` and BFF routing — single-knob by construction. In the
  chart venue, the replica count and the BFF routing env are separate values;
  the spine never states they must derive from one key. A deployer sets
  routing=true with replicas=0 (or a stale agent image): every request takes
  the agentic route into a service that has zero replicas — the
  half-activated deployment AD-9 exists to prevent. Both builders comply;
  nothing they were given forbids the split.
- **ADs checked (quoted):**
  - AD-9: "One activation flag (pattern: `OKF_ENABLED` — compose replicas +
    BFF routing) switches BFF routing at the `initStreamQuery` seam…" — the
    parenthetical is compose-shaped; no chart-venue rule.
  - Structural seed: "Deployment shape (both venues: Swarm compose and k3s
    chart)" — asserts the venue, not the single-source rule in it.
  - Conventions: "activation flag gates compose + routing together" —
    compose only.
- **Tightened AD (proposal):** Extend AD-9: "The activation flag has exactly
  one source of truth per venue — compose env var; a single chart value
  consumed by BOTH the agent-service replica count and the BFF routing env —
  never independently settable; a pre-deploy check fails on routing=true
  with replicas=0."

## ADV-10 — The agent path's `metadata` frame payload (and the persisted citation serialization) is unspecified

- **Severity:** medium
- **Units:** S4 event-shaping builder × BFF persistence writer + frontend
  citation components (legacy surface) × rollback engineer.
- **Scenario:** AD-8 preserves the `metadata` frame's type and terminal
  position, and AD-9 requires "saved-conversation citations, and rollback
  continuity (agentic conversation continued on legacy) work without data
  changes". But nothing pins the agent path's `metadata` **content**: all
  evidence from every search step (an FR-3 provenance reading) vs only the
  final cited subset (an FR-13 reading); and the citation serialization —
  legacy `file_id` form vs the OKF `concept_id + repo_id + bundle_version`
  triple, in whatever wrapper the existing RAG citation components consume.
  Builder A emits the full per-step evidence set; Builder B emits final
  citations only: the frontend renders different citation lists, saved
  conversations persist different payloads, and after rollback the legacy
  path re-renders a citation payload it may not resolve — "same shape" was
  asserted of the `queries` doc, not of the citation objects inside the
  frames. E01/E02 citation checks score different artifacts depending on
  which builder won.
- **ADs checked (quoted):**
  - AD-8: "The five client event types … and the terminal order … are
    preserved verbatim." — frame contract, not payload schema.
  - AD-9: "The agentic path mints a `queries`-collection doc (same shape)
    so persistence, analytics, saved-conversation citations, and rollback
    continuity … work without data changes." — "same shape" binds the doc,
    not the citation serialization it carries.
  - Conventions: "Stable source ids — Legacy: `file_id` … OKF: `concept_id`
    + `repo_id` + `bundle_version`, resolved by exact join…" — resolution
    defined; wire/persistence serialization not.
- **Tightened AD (proposal):** "The agent path's `metadata` frame payload is
  fixed at S3 as part of the additive SSE contract: final cited sources
  only, serialized exactly as the legacy path serializes them for the
  existing citation components (V05 records the legacy form, both id
  families); intermediate evidence rides trace attributes, never the client
  frame."

---

## Verdict

**REVISE.** The spine's structure (port/loop/edge separation, AD-1..AD-12
coverage of the PRD's own risk list) holds; no finding breaks the paradigm.
But ten seams let two fully-compliant builders ship incompatible systems —
four of them (ADV-1, ADV-2, ADV-3, ADV-4) break user-visible correctness,
the audit chain, or the E02 experiment the initiative exists to produce. All
ten close with tightened AD text (proposals inline); none requires
restructuring. Recommend folding the proposals into the spine before story
extraction, since S3 and S4 are exactly the two builders that will hit
ADV-1/3/4/6 first.
