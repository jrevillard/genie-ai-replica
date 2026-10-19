# Scaling design — RAGAS generation and runs on large repositories

Companion to SPEC.md (added 2026-10-18, David's hard requirements after live
use; revised same day after the vanish incident and the no-auto-trash
direction). The shipped 8-6 implementation is corpus-linear per generation;
this design replaces that. Lives as future work (Story 8-6b) until scheduled.

## The hard requirements (David, 2026-10-18)

1. **Asynchronous, closeable**: the user can close the dialog mid-generation
   and return later; state survives and is visible.
2. **100-question suite from 2 large repositories must generate in ≤ 1 hour.**
   The hour is a DESIGN TARGET for this redesign — never an enforcement
   timer. Verbatim direction: *"I do not want to trash work automatically
   after 1 hour."* Nothing may destroy a running generation on a clock; the
   only things that end a healthy job are its own completion or the user.
3. **Running a RAGAS suite must not take much longer than the existing
   head/query suites.**
4. **Speed comes from parallelism sized to the host** — multiple worker
   processes that take advantage of the machine the sidecar runs on, not a
   bigger timeout.
5. **Progress in the UI, cancel in the UI**: the user can watch progress
   throughout and cancel/kill whenever they like if it is taking too long.

## Cost model (measured, 2026-10-17/18)

`time ≈ (KG passes × concepts + synthesis + judging) × per-call latency
× contention`. Live: 127 concepts ≈ 20 min; ~12 nodes still 10–20 min because
~7 passes × 2–8 s/call on the shared GPU dominates;
`OKF_RAGAS_MAX_CORPUS_CONCEPTS=400` silently truncates large repos (first-400
alphabetical). The ragas KG is in-memory only (discarded per job) — nothing
reuses the platform's per-repo Arango graphs.

## Shipped reliability fixes (8-6 fix batch, 2026-10-18 — the prereqs)

The 2026-10-18 vanish incident (job `09ef44c3ce9b`) exposed three defects
fixed in that batch; 8-6b builds on them:

- **Thread confinement**: ragas's Executor re-enters the running loop via
  nest_asyncio (`executor.py:214`); driven on the uvicorn loop it corrupted
  the ready-deque (`IndexError: pop from an empty deque`), killed the server,
  restarted the container, and vanished every in-flight job. Both heavy legs
  (`apply_transforms`, `generate`; `evaluate` too) now run via
  `asyncio.to_thread` — ragas takes its plain `asyncio.run` path on a private
  ephemeral loop. (Full multi-process isolation is D5 below.)
- **Tolerant synthesis**: with `raise_exceptions=False`, one failed question
  becomes `np.nan` (`executor.py:84`) and pydantic rejects the whole Testset
  (`generate.py:610`) — one bad question killed the run. Synthesizers
  (default mix included) are wrapped in `_TolerantSynthesizer`; failures
  become droppable empties, counted in `dropped`.
- **No auto-trash**: `OKF_RAGAS_LONG_TIMEOUT_MS` is now a LIVENESS HORIZON —
  a reachable running job never times out (the horizon rolls; only the
  user's cancel ends it); it bounds only the unreachable-sidecar case. UI
  poll horizon raised to 24 h with the job-keeps-running message. Cancel is
  cooperative (`cancel_event`): remaining synthesizer calls short-circuit,
  so a cancelled run drains within one in-flight LLM batch.

## Design

### D1 — Persistent generation placeholder (requirement 1)

`beginSuiteGeneration` writes a `ragas_suite` doc immediately with
`status: 'generating'` (+ repos, dimensions, started_at), replacing the
in-memory `genInFlight`-only visibility. The saved-suites list renders it with
a spinner + elapsed; completion replaces it with the full suite (same _key);
failure writes `status:'failed'` + error. The boot sweep already marks
interrupted runs — extend it to generating placeholders. UI: closing the
dialog changes nothing (store poll already optional); reopening shows live
state from the doc. `genInFlight` stays only as the one-per-repo lock.

### D2 — Seed the KG from the platform's per-repo graphs (requirement 2)

Each OKF repo already has a knowledge graph in ArangoDB (`<GRAPH>_SOURCE`
chunks + embeddings, `<GRAPH>_LINKS_TO`, `<GRAPH>_HAS_SOURCE`, entities from
ingest). Generation reads those collections and constructs the ragas
`KnowledgeGraph` nodes/relationships directly — no LLM re-derivation of
entities/relationships. The LLM fills only question-oriented metadata
(summaries/themes) **for the sampled nodes only** (D3). Multi-repo input
merges graphs with `repo_id` on every node so multi-hop questions still cross
boundaries. Seeding is Arango-read-bound: seconds, not minutes.

### D3 — Stratified sampling instead of corpus-linear passes (requirement 2)

`K = max(60, 3 × testset_size)` concepts per repo, stratified by theme/label
frontmatter and graph community (mix across communities, not alphabetical
first-N). `OKF_RAGAS_MAX_CORPUS_CONCEPTS` is replaced by this documented
sampling strategy (configurable K multiplier; sampling report stored on the
suite doc: concepts considered vs sampled, per repo). Per-concept text still
window-capped (`RAGAS_DOC_CHAR_CAP=auto` — unchanged).

### D4 — Synthesis concurrency + judge routing (requirements 2, 3, 4)

- ragas `RunConfig.max_workers` raised for synthesis and judging (I/O-bound
  LLM calls; the semaphore admits more in-flight calls).
- **okf-server `RUN_CONCURRENCY` (2 → 6)** for the run's retrieval+answer legs.
- **The frontier-model routing (spec-okf-frontier-model-routing, 8-7) becomes
  the default judge for `ragas_generation` and the recommended default for
  `ragas_judging`**: ~1–2 s/call uncontended vs 2–8 s contended local.

### D5 — Worker-process pool, sized by the host (requirement 4)

The sidecar gains a process pool for CPU-bound work (KG transform
aggregation, KG seeding/marshalling), sized like the platform's other lane
variables — both halves together, derived from cores (the
CAPACITY-SIZING precedent: `min(16, cores/2)`-class sizing, memory-checked).
LLM-bound legs stay async-I/O (threads are enough there); the pool exists so
CPU stages neither starve the event loop nor serialize. Each job's heavy leg
runs as a unit inside one worker (the thread-confinement fix generalizes to
process confinement), which also hardens the sidecar: a worker crash is a
failed job, never a dead server.

### D6 — Live progress + always-available cancel (requirement 5)

- **Progress**: the phase channel gains per-unit counts (KG `i/n` transforms,
  synthesis `questions i/n`, judging `rows i/n`) reported through the job
  snapshot; the generating placeholder (D1) surfaces them in the suites list,
  so progress survives closing the dialog.
- **Cancel**: the cooperative `cancel_event` (shipped) is exposed as an
  explicit Cancel control on the generating placeholder and the running
  benchmark — not only via suite deletion. Cancel drains within one in-flight
  LLM batch (shipped semantics) and writes `status:'cancelled'` on the
  placeholder.

### The budget arithmetic (requirement 2 proof)

100 questions, 2 large repos: seeding (Arango, seconds) + sampled
summary/theme fills (K×2 calls ≈ 120–600, concurrent) + synthesis (100 × 4–6
calls ≈ 500-600, concurrent). Total ≈ 700–1,200 LLM calls at concurrency 8:
frontier ≈ 1.5 s/call → **3–6 min**; local contended ≈ 5 s/call →
**~10–15 min**. Both ≪ 1 h, and independent of corpus size.

### Run-time budget (requirement 3)

Run = retrieval (identical to head suites) + 100 answers + 100 × selected
metrics judging ≈ 500–900 LLM calls, concurrent: frontier judge → target
**≤ 2× a head-suite run**; local-only worst case ~3–4×, stated in the docs.
Non-goals: exact parity with retrieval-only suites (two LLM legs exist by
definition); Batch APIs (phase 2, via the 8-7 adapter).

## Kubernetes deployment constraints (David, 2026-10-18)

The judge cache volume raised the question of what HPA means for this
service. The honest answer has two layers:

- **The volume is the smaller blocker.** `ragas_llm_cache` is a pure
  performance layer (judge responses keyed by prompt hash); suites, runs and
  results live in ArangoDB and never depend on it. On k8s: Deployment
  `replicas: 1` + a ReadWriteOnce PVC (or `emptyDir` if cold caches after
  rescheduling are acceptable — that is exactly the `/tmp` behaviour the
  volume replaced). Losing the PV costs re-judging time, never data.
- **The in-memory job registry is the real HPA blocker — with or without the
  cache.** The sidecar's job dict, per-job progress and `cancel_event`s are
  per-pod state; okf-server polls `GET /jobs/{id}` expecting to reach the pod
  that owns the job. Behind a k8s Service with more than one replica,
  round-robin routing orphans every poll. The same class of constraint sits
  on okf-server (`genInFlight`/`runInFlight`/`genProgress` Maps).

**Consequence:** horizontal scaling requires externalizing job state (Redis
is already in the stack) and making job polling replica-addressable — that is
a prerequisite for HPA on BOTH services, not a cache problem. Until then,
k8s posture is `replicas: 1` + RWO PVC + a PodDisruptionBudget for
ragas-service, and the scaling lever is D5's host-sized worker pool INSIDE
the single pod — which is where "use the machine's resources" already lives.

## Story

Tracked as **8-6b** (design done; implementation scheduled after 8-7). No
changes to the shipped 8-6 wire formats, xlsx compatibility, or run semantics
— this is internals + persistence + sampling + parallelism. The reliability
prereqs (confinement, tolerant synthesis, liveness horizon, cooperative
cancel) shipped with the 8-6 fix batch on 2026-10-18.
