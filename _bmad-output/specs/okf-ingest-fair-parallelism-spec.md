# Spec: Fair, Parallel OKF Repo Ingestion — Remediation for Cross-Repo Starvation

- **Status**: IMPLEMENTED on `feat/okf-ingest-fairness` (commits e848e8c…9eb565d, 2026-09-26), then **hardened by the max-effort code review** (15 findings; 14 fixed same day — see §12). Defaults unchanged (`fifo`, backoff off, cap 0, adaptive off) — rollout per §8. Deviations: `last_kick_error` not added (duplicates `last_worker_error`); dashboard chip renders only when >1 repo is armed (single-repo noise); spec §7 items 7-9 (multi-worker chaos + live soak) run against the live stack, not jest.
- **Date**: 2026-09-26
- **Author**: Engineering (AI-assisted), from the 2026-09-25/26 starvation incident
- **Scope**: OKF repo ingestion (okf-server ingest worker + claim path). **The legacy shared-graph (`GRAPH`) single-file, file-locked ingestion path is OUT OF SCOPE and MUST NOT be modified.**
- **Related**: ADR okf-030 (lifecycle state machine), ADR okf-031 (versioning)

---

## 1. Background

The OKF ingest worker (`components/okf-server/workers/ingestWorker.js`) drains concept
preparation into per-repo RAG graphs. The queue IS the `okf_concepts_meta` collection —
a deliberate design decision ("no Redis", ingestWorker.js:10-12); the worker claims rows,
kicks dataprep, and dataprep calls back to transition each concept to `indexed`/`failed`.
Per-repo graphs (`OKF_<slug>_vN`) are disjoint — two repos' ingests never contend on
graph state. This disjointness is the foundation the remediation builds on: **concepts
are independent units of work with no shared graph mutation**, so fairness and
parallelism at the claim layer carry no graph-corruption risk (verified write semantics:
`import_bulk(on_duplicate='update')`, deterministic `_key`s — langchain_arangodb
`arangodb_graph.py:659`).

## 2. Incident timeline (2026-09-25/26, local dev stack)

| Time (UTC) | Event |
|---|---|
| 12:07 | UK gov crawl repo (`b684b294`, 997 concepts) drain armed for v3 (born-right graph `OKF_www-gov-uk-full-crawl_v3`) |
| 12:07→17:46 | Steady drain on 6 lanes (`OKF_INGEST_CONCURRENCY=6`), ~2–5 concepts/min, 0 failed |
| 17:18 | Transient Keycloak token outage → dataprep kicks fail; failover + row-touch design absorbs it (no data loss). Keycloak restart at ~17:28 unblocked it. |
| 17:39:50 | **Second repo armed**: Indonesia History–LLM (`f5299e77`, 999 concepts, rows stamped Sep-12/13) |
| 18:00:44 | UK drains to **995/997**; last 2 rows never claimed again |
| 18:00→04:45+ | UK frozen **10+ hours**. Indonesia progresses at ~0.5/min (321/999 by 04:45) |
| root cause | `claimNextJob` sorts **all armed repos' rows by `updated_at ASC LIMIT 1`** (ingestWorker.js:113-114) — Indonesia's Sep-12 rows own the FIFO head; the UK's Sep-25 rows sit behind ~700 of them. Projected full wait: ~22 h at Indonesia's actual pace. |
| workaround | Manual FIFO nudge: backdate the 2 UK rows' `updated_at` (the documented order key, :88-93) below Indonesia's oldest. |

**Second finding (same window)**: two UK consultation concepts with ~230-char
concept_ids fail dataprep kick **deterministically** — dataprep writes the payload to
`./uploaded_files/<conceptId>.md` and the filename exceeds the filesystem's 255-byte
limit (`OSError: [Errno 36] File name too long`). The worker retries until the reaper's
`OKF_INGEST_WORKER_MAX_CLAIMS` (8) dead-letters them. Deterministic poison-by-name;
see defect F-1.

## 3. Current architecture (verified 2026-09-26, branch `feat/okf-server`)

All citations `file:line`.

### 3.1 Claim path

- **Queue = collection.** No Redis; `okf_concepts_meta` rows with `index_status='parsed'`
  are the queue (ingestWorker.js:10-12, :105). The worker is the only *observer* of
  terminal concept states — the dataprep callback owns them via the internal endpoint
  (internal-controller.js:181-216).
- **Global FIFO** (ingestWorker.js:101-121): `FILTER index_status=='parsed'`,
  workflow gate join (`repo.rag_drain_active==true`, :107-108), claim-staleness filter
  (:112), then **`SORT m.updated_at ASC LIMIT 1` across ALL armed repos** (:113-114).
  No per-repo fairness of any kind — the incident mechanism.
- **Claim = read then stamp** (:102-117 then :125-141): two round trips serialized only
  by an in-process promise mutex (`claimNextSerialized`, :968-980), which explicitly
  assumes "One okf-server container" (:968-971). Not atomic across processes.
- **Lanes**: `OKF_INGEST_CONCURRENCY` lane timers, default 1 (:964-966; local env runs 6).
  Lanes never overlap themselves and self-reschedule in `finally` (:993-1026); a wedged
  cycle is released after `OKF_INGEST_WORKER_CYCLE_TIMEOUT_MS` (30 min, :1000).

### 3.2 Per-job path (`_processOneJob`, :316-674)

Graph-existence pre-flight (:321-383 — currently DEAD CODE, §4 G-2) → WS5
always-retract-before-POST (:391-421) → dataprep kick POST (:433-455) →
`waitForTerminal` poll (:227-248) with timeout dedupe guard (:551-592) → D4-b single
re-index retry (:598-618). Error paths: 429 → claim cleared, FIFO position preserved,
no transition (:457-477); other POST failures → `last_worker_error` + claim cleared +
`updated_at` touched (head-of-line escape, :478-509).

### 3.3 dataprep side

- Flock slot pool `DATAPREP_INGEST_CONCURRENCY` (default 1; microservice :70, slots
  :73-90, synchronous 429 when full :192-208, orphan-slot defense :210-240).
- Kick returns 202 immediately; the heavy pipeline runs as a background task.
- Per-repo graph writes: `_ensure_graph_collections` (arangodb :2053) then batched
  `import_bulk(on_duplicate='update')` — deterministic `_key`s, upsert semantics.
- LLM resilience ladder (arangodb :468-565); empty-graph refusal (:2107-2133); failure
  path = 'Ingestion Error' callback carrying the cause + auto-retract (:2189-2211).

### 3.4 Recovery machinery

- Reaper `_reapStuckParsed` (:771-816): dead-letters on claim-age > 1 h
  (`OKF_INGEST_WORKER_REAP_GRACE_MS`) or `ingest_attempts >= 8`
  (`OKF_INGEST_WORKER_MAX_CLAIMS`). Row-age/`updated_at` are **never** reap signals
  (:746-767 — age rules mass-killed healthy backlogs twice historically).
- Hourly sweep order: reconcile (settle armed repos at 0 parsed, :900-918) → bundle
  sweep (with `is_bundle` exclusion, :709) → reaper → orphan dead-letter (:1034-1041).
- Startup reconcile settles armed repos on boot (:1050-1055).

### 3.5 Legacy path isolation (confirmed)

Legacy single-file ingest originates in doc-repo (`fileController._ingestFileById`,
document-repository fileController.js:1052-1107) and carries NO `conceptId`/`repoId` —
inside dataprep it takes the legacy branches: shared `GRAPH` fallback
(microservice :143-145, :283), callback to doc-repo (arangodb :818-823). The OKF worker
is the only producer of OKF kicks. **Changing OKF claiming cannot alter legacy control
flow.** The one shared coupling: both consume the same dataprep process and flock slot
pool (legacy traffic can 429-starve OKF kicks and vice versa) — acceptable, unchanged.

## 4. Verified defects and gaps

| ID | Finding | Cite | Fix |
|---|---|---|---|
| G-1 | **Cross-repo FIFO starvation** — the incident. One global ordering; small-repo tails wait behind entire backlogs. Extra lanes do NOT fix it (they claim the next-oldest rows, still all from the big repo). | ingestWorker.js:113-114 | Fair claim strategy (§5.2) |
| G-2 | **Dead missing-graph pre-flight**: `if (!graphLifecycle.graphExists(db, expectedGraph))` omits `await`; `!Promise` is always false — the reset branch (:338-374) never runs in production; floating promise risks unhandled rejection. Jest stub (`async () => true`, ingest-worker.test.js:41) masks it. | ingestWorker.js:337 | Add `await`; fix the jest stub; add a reset-branch test |
| G-3 | **Latent dotted-key bug in the same reset**: `'rag_ingestion.concepts_done': 0` etc. land as FLAT attributes, not nested paths (the documented gotcha at :156-161) — even if G-2 were fixed, the reset silently fails to reset the dashboard card. | ingestWorker.js:344-348 | Nested-object patch like `_refreshRagIngestion` (:175-182) |
| G-4 | **No double-settle serialization**: `_settleIngest` has no in-function guard; callers use non-atomic read-then-act checks. Concurrent settles converge only by value-idempotency; the from≠to rename path is unserialized (drop + 4 renames). Safe single-container; hazard for multi-worker. | lifecycle-service.js:250-351; ingestWorker.js:195-196 | Settle CAS (§5.5) |
| G-5 | **Single-container claim mutex**: read+stamp is two round trips; multi-replica okf-server would double-claim (second UPDATE runs in a fresh transaction and overwrites the first claim blindly). | ingestWorker.js:968-980, :102-141 | Atomic fused claim (§5.3) |
| G-6 | **429 head-of-line loop**: the busy path clears the claim WITHOUT touching `updated_at`, so every lane re-claims the same head row each poll while dataprep slots are full. | ingestWorker.js:465-476 | Accepted transient behavior; per-repo caps reduce over-admission (§5.4) |
| G-7 | **No per-concept kick backoff**: a 500ing concept re-enters the FIFO immediately and burns claim attempts at lane speed (8 attempts can die in ~2 min during a dataprep restart — the exact dead-lettering live failure documented at :488-496). Plus the deterministic ENAMETOOLONG poison (§2). | ingestWorker.js:478-509 | Kick-5xx backoff (§5.6); F-1 filename fix (§5.8) |
| G-8 | **No queue observability**: nothing exposes "repo X waits behind N concepts from M repos" — the incident was invisible until manual queries. | — | Observability (§5.7) |
| G-9 | **`requeueRepoForRedrain` vaults a repo to the FIFO head** (sets `updated_at = now` for every row, concept-meta-service.js:352) — harmless under fair claim, but an ordering footgun under fifo. | concept-meta-service.js:338-359 | Note; fair claim makes it moot |
| G-10 | **Timeout–restart livelock on heaviest concepts**: the worker abandons a job at `JOB_TIMEOUT_MS` (30 min) and WS5's next attempt RETRACTS the in-flight work, restarting the concept from scratch. Concepts whose pipeline exceeds 30 min (observed: 17 timeouts in 16 h, all on ~0.5–1.7k-chunk Wikipedia pages) can loop indefinitely — each 30-min lane slot restarts, never completes. The concept eventually completes only when a run fits the window; otherwise attempt-ceiling dead-letter. | ingestWorker.js:227-248, :37; audit `ingest.timeout` ×17 | Size-adaptive windows + liveness-probe deferral (§5.9, with §5.5) |
| G-11 | **Load asymmetry is content-driven (measured)**: Indonesia History–LLM carries **18× the content** of the UK repo (avg body 110 KB vs 6.3 KB; 107 MB vs 6 MB total; ~155 vs ~9.8 chunks/concept at the same chunk size 500). Pipeline cost is linear in chunks → every stage (contextualization, labeling, extraction, embedding, writes) scales ~16× per concept, explaining the observed ~10× wall-clock difference. "Concept count" is not a load measure — chunk count is. | measured 2026-09-26 | Use chunk count (not concept count) for capacity planning and ETA math; feeds §5.7 observability. |

## 5. Design: weighted-fair claim + atomic claim + guarded settle

**Chosen approach (Option C)**: fair claim policy implemented as ONE fused atomic AQL
statement, per-repo in-flight caps, settle CAS, kick backoff, and additive config with
today's behavior as the default. Rationale vs alternatives:

| Option | Starvation fix | Scale-out | Complexity | Verdict |
|---|---|---|---|---|
| A. More lanes | None — the big repo fills every lane first | No | Trivial | Insufficient |
| B. Per-repo cap, FIFO kept | Yes (minimal) | Partial | Low | Minimal fallback |
| **C. Fair claim + cap + atomic claim + settle CAS** | **Yes — bounded wait** | **Yes** | Medium | **Chosen** |
| D. Per-repo claim loop in JS | Yes | Partial | Medium | More moving parts; no DB-side fairness |
| E. External queue (Redis/BullMQ) | Yes | Yes | High | Rejected — contradicts "the queue IS the collection" (ingestWorker.js:10-12); splits source of truth from settle gates |

### 5.1 ArangoDB atomicity basis (verified semantics)

One AQL query = one implicit transaction (all-or-nothing). On the RocksDB engine,
concurrent transactions modifying the same document produce a **write-write conflict:
error 1200 aborts the loser's ENTIRE query (nothing written)**; the client retries.
Therefore a claim whose READ and WRITE are in the SAME statement is a correct CAS:
two workers snapshot the same head row, one wins, the loser retries with a fresh
snapshot and claims the next row. Today's two-statement shape (read in `claimNextJob`,
write in `_stampClaim`) has no such protection — the loser's UPDATE runs in a new
transaction and blindly overwrites the first claim.

### 5.2 Fair claim (strategy `fair`) — fused single statement

```aql
LET timeout = DATE_NOW() - @jobTimeoutMs            /* JOB_TIMEOUT_MS, :37 */
LET armed = (FOR r IN okf_repositories
             FILTER r.rag_drain_active == true AND r.deleted_at == null
             RETURN r.repo_id)
/* Repo selection: least in-flight first, oldest head as tiebreak; per-repo cap. */
LET repo = FIRST(
  FOR m IN okf_concepts_meta
    FILTER m.index_status == 'parsed' AND m.repo_id IN armed
    FILTER m.next_attempt_after == null OR DATE_TIMESTAMP(m.next_attempt_after) <= DATE_NOW()
    COLLECT r = m.repo_id AGGREGATE
      inFlight = SUM(m.worker_claimed_at != null && DATE_TIMESTAMP(m.worker_claimed_at) >= timeout ? 1 : 0),
      oldest   = MIN(m.updated_at)
    FILTER inFlight < @perRepoCap          /* OKF_REPO_INGEST_CAP; 0 = unlimited */
    SORT inFlight ASC, oldest ASC
    LIMIT 1
    RETURN r)
FILTER repo != null
/* Row claim inside the winning repo: oldest claimable row. */
LET cand = FIRST(
  FOR m IN okf_concepts_meta
    FILTER m.repo_id == repo AND m.index_status == 'parsed'
    FILTER (m.worker_claimed_at == null OR DATE_TIMESTAMP(m.worker_claimed_at) < timeout)
      AND (m.next_attempt_after == null OR DATE_TIMESTAMP(m.next_attempt_after) <= DATE_NOW())
    SORT m.updated_at ASC
    LIMIT 1
    RETURN m)
FILTER cand != null
UPDATE cand WITH {
  worker_claimed_at: DATE_ISO8601(DATE_NOW()),
  ingest_attempts: (cand.ingest_attempts == null ? 0 : cand.ingest_attempts) + 1
} IN okf_concepts_meta
RETURN KEEP(NEW, ['repo_id','concept_id','graph_name','frontmatter','body',
                  'ingest_labels','bundle_version','updated_at','last_good_index_at','reindex_retry'])
```

- The `COLLECT AGGREGATE` repo scan is fused into the same statement — per-repo
  in-flight counts come free; no counter-on-repo-doc scheme (write coupling + drift
  risk; this codebase has live incidents with lying counters, :156-161).
- Cost: one index-range pass over `parsed` rows per claim, ~20-80 ms at 100k rows —
  negligible against the 15 s poll interval.
- On error 1200: catch, retry once immediately (fresh snapshot → next row), else next poll.
- The `fifo` strategy keeps today's code path byte-for-byte.

**Indexes** (`db/collections.js:38-41`, add to `INDEXES.okf_concepts_meta`):
- `{ type:'persistent', fields:['index_status','updated_at'] }` — global FIFO scan.
- `{ type:'persistent', fields:['repo_id','index_status','updated_at'] }` — per-repo
  candidate scan; also speeds `countByIndexStatus` (settle/refresh/callback).

### 5.3 Per-repo in-flight cap

`OKF_REPO_INGEST_CAP` (0 = unlimited = today). Enforced in the fair scan
(`FILTER inFlight < cap`). Bounded-wait guarantee: with R armed repos and L lanes and
cap C, a newly armed small repo's rows are claimable within one cycle of any cap
release — the observed starvation (tail behind an entire 999-row backlog) is
structurally impossible.

### 5.4 Multi-worker scale-out — race-by-race

| # | Race | Resolution |
|---|---|---|
| 1 | Claim double-claim | Fused statement + 1200 retry (§5.1-5.2). `claimNextSerialized` kept for fifo mode; redundant-but-harmless in fair mode. |
| 2 | Double-settle (`_settleIngest`) | **New settle CAS** — first step of `_settleIngest`: conditional `UPDATE okf_repositories SET settle_claimed_at=now WHERE _key==rid AND rag_drain_active==true AND (settle_claimed_at==null OR older than OKF_SETTLE_LEASE_MS)`; proceed only if the update matched 1 row. Release on promote failure; the final flip clears `settle_claimed_at`. Lease 10 min. Single-worker behavior identical. |
| 3 | Progress write vs settle race (`_refreshRagIngestion` :162-182 — read-then-write TOCTOU, the documented Bali resurrection race) | Fuse check+write into ONE conditional statement (`FILTER rag_drain_active == true UPDATE ...`), closing the race entirely (single-worker benefit too). |
| 4 | Reaper double dead-letter | Optional: conditional `UPDATE ... FILTER index_status=='parsed'` per victim; mirror only when 1 row affected. Semantics preserved. |
| 5 | Concurrent terminal callbacks | No change needed — `transitionBundle` idempotent PATCH, manifest overwrite-on-settle, author links deterministic keys + overwrite (internal-controller.js:61-130; edge-service.js:121-168). |
| 6 | Sweep double-fire | Idempotent (404-tolerant retract, second REMOVE 404s harmlessly). Accept. |
| 7 | 429 spinning across workers | By design; per-repo caps reduce over-admission. |

### 5.5 Kick-5xx per-concept backoff

- New meta fields: `next_attempt_after` (ISO string or null), `last_kick_error`.
- Set on kick throw with `status >= 500` or no-response error, and `kick.status >= 500`:
  `next_attempt_after = now + min(OKF_KICK_BACKOFF_MAX_MS, OKF_KICK_BACKOFF_BASE_MS × 2^(attempts-1)) + jitter(0..25%)`.
- **NOT set on 429** (slot busy — keep prompt retry; self-regulates against flock slots).
- Claim filter (both strategies once fields exist): `AND (next_attempt_after == null OR <= now)`.
- Reaper interplay: ceiling unchanged (8 attempts); backoff spreads them (~1 h at base 60 s / cap 15 min) so a transient dataprep restart no longer converts to a dead-letter.
- Reset points: `requeueRepoForRedrain` (concept-meta-service.js:338-359) and the graph-missing reset — both add `next_attempt_after: null`.

### 5.6 Defect fixes riding with this spec

- **F-1 (dataprep, G-7 root)**: hash long upload filenames — the microservice's
  `uploaded_files/<name>` write must map names over a safe threshold (e.g. > 200 bytes)
  to `<sha256(name)>.md` (the graph layer already hashes entity keys — same class).
  Fixes the deterministic consultation-concept poison for the whole corpus. Applies to
  the shared write helper; **no legacy mechanism change** (same request shape, same flow).
- **F-2 (G-2)**: `await` the graphExists pre-flight; fix the jest stub.
- **F-3 (G-3)**: nested-object patch in the graph-missing reset.

### 5.7 Observability

- Log fields: `claim_wait_ms`, `repo_queue_depth` (free from the fair scan), `repo_in_flight`, `strategy`, `lane`.
- Metrics: `repo` attribute on `okf_ingest_worker_jobs_total`; UpDownCounter
  `okf_ingest_worker_lanes_busy`; ObservableGauge `okf_ingest_repo_queue_depth` fed from
  `_refreshRagIngestion`'s existing counts.
- Dashboard: extend the `rag_ingestion` patch with `queue: {parsed, in_flight, armed_repos}`;
  chip renders "waiting behind N concepts from M repos" (one i18n key per locale).

### 5.8 Config surface — all defaults = today's behavior

| Env | Default | Meaning |
|---|---|---|
| `OKF_CLAIM_STRATEGY` | `fifo` | `fifo` = current path unchanged; `fair` = §5.2 |
| `OKF_REPO_INGEST_CAP` | `0` | 0 = unlimited; >0 = per-repo in-flight cap |
| `OKF_KICK_BACKOFF_BASE_MS` | `0` | 0 = off; >0 = exponential kick-5xx backoff base |
| `OKF_KICK_BACKOFF_MAX_MS` | `900000` | backoff cap (15 min) |
| `OKF_SETTLE_LEASE_MS` | `600000` | settle CAS lease; inert single-worker |
| `OKF_JOB_WINDOW_ADAPTIVE` | `false` | false = flat 30-min window (today); true = size-based window (§5.9) |
| `OKF_JOB_WINDOW_FLOOR_MS` | `1800000` | minimum wait window (today's flat value) |
| `OKF_JOB_WINDOW_MAX_MS` | `21600000` | window cap (6 h) |
| `OKF_JOB_WINDOW_SEC_PER_CHUNK_MS` | `5000` | calibrated pipeline ms per chunk (from drain telemetry) |

### 5.9 Size-adaptive job windows + large-concept-file handling

**Problem (G-10).** The flat 30-min `JOB_TIMEOUT_MS` window structurally aborts any
concept whose pipeline exceeds it. The next claim's WS5 retract **destroys the in-flight
dataprep work** and re-kicks from zero — concepts larger than the window pay 2–3× their
pipeline time and ~50% of their GPU work is retracted and redone (measured: 17 timeout
loops in 16 h on Indonesia's chunk-heavy corpus; zero on the UK's small-file corpus).
Large files are the exclusive victims.

**Design — the window scales with the work:**

1. **Window estimator.** `window(concept) = clamp(OKF_JOB_WINDOW_FLOOR_MS, OKF_JOB_WINDOW_MAX_MS, chunks × OKF_JOB_WINDOW_SEC_PER_CHUNK_MS × 1.5)` where
   `chunks ≈ ceil(LENGTH(body) / chunkSize)` (use `chunk_count` when already set from a
   prior attempt). Bucket behavior at the defaults: <50 KB → 30 min; ~200 KB → ~90 min;
   ~500 KB → ~3 h; monsters capped at 6 h.
2. **Lockstep the lane wrapper.** `OKF_INGEST_WORKER_CYCLE_TIMEOUT_MS` must be
   `max(cycleFloor, window)` for the claimed job — otherwise the lane wrapper releases a
   lane whose job is still legitimately waiting (desync → overlap risk).
3. **Expiry = probe, not kill.** On window expiry, query dataprep's task registry
   (`active_ingestion_tasks[fileId]`, microservice :320) before re-kicking:
   - **Task alive** → defer: set `next_attempt_after = now + window`, clear the claim,
     NO retract (§5.5 mechanism). The in-flight run completes and its callback flips the
     row — the dedupe guard (:551-592) already accepts that outcome.
   - **Task dead/unknown** → reclaim immediately (today's behavior; the next kick's WS5
     retract is then correct — nothing alive to destroy).
4. **WS5 unchanged on real re-kicks**: a genuine dead-task reclaim still retracts before
   re-POST; the deferral path simply never reaches a re-kick while work is alive.
5. **Telemetry**: log `window_ms` vs actual duration per job; new counter
   `okf_ingest_job_window_exceeded_total` (attribute: size bucket) — feeds the
   `SEC_PER_CHUNK` calibration.

**Why fundamentally positive**: the window doesn't create cost — it stops *aborting*
paid work. One dataprep run per concept, zero retraction waste, zero attempt-burning on
size alone. Combined with §5.5 (deferral) it removes the G-10 livelock class entirely;
combined with doc-level contextualization and chunk-size levers it takes chunk-heavy
repos from ~40 h toward single-digit hours (see the load appendix, §11).

**Tests**: window computation (bytes→chunks→ms, clamp bounds); cycle-lockstep assertion;
expiry with alive task → deferred, no retract call, no attempts bump, callback accepted
later via dedupe guard; expiry with dead task → immediate reclaim + retract on next kick;
adaptive-window end-to-end on a seeded >30-min concept (simulated clock).

## 6. Invariants (MUST hold after any change)

1. Workflow gate: only armed (`rag_drain_active`), non-deleted repos are claimable.
2. Single owner of terminal concept transitions: the internal callback only.
3. WS5 retract-before-POST on every kick.
4. Claim-staleness recovery (JOB_TIMEOUT) and no double-claim within the window.
5. Reaper triggers only on claim-age or claim-count; never row age/`updated_at`.
6. `updated_at` is the FIFO order key: claiming never touches it; POST-fail touches it; 429 never does.
7. Claims cleared on 429 / kick failure / genuine timeout.
8. Timeout dedupe: never requeue a concept dataprep already settled.
9. D4-b single re-index retry bound.
10. Settle coverage on job completion, sweep reconcile, and boot; terminal `rag_ingestion` record honest ('failed' wins); recoverable via retract → re-ingest.
11. Disarm guards: no resurrection of cancelled drains.
12. Bundle zips live forever (sweep `is_bundle` exclusion; fail-closed orphan predicate).
13. Repo-gone rows dead-letter terminally; GRAPH-GONE stays recoverable.
14. Callback auth fail-closed with the internal secret.
15. **Legacy path isolation**: no change to doc-repo-originated ingest, `GRAPH` fallback, or doc-repo status callbacks (verified: OKF kicks are the only `conceptId+repoId` producers).
16. Honest verdicts: never report success over a failed/empty graph; every drain failure reaches the ingestion log.

## 7. Test design

Existing patterns to extend: `__tests__/ingest-worker.test.js` (positional query
programming :70-81; claim-stamp shape detection :74-75), mock db `__tests__/mocks/arango-mock.js`.

**Unit (jest, mocked db):**
1. **Starvation repro (the acceptance case)** — repo A 999 parsed rows (old `updated_at`) armed, repo B 2 parsed rows (newer) armed later. Under `fair` + cap 2: B's rows claim first; B settles within the simulated window. Under `fifo`: A claims first (regression baseline, documented).
2. Per-repo cap enforcement (A at cap → excluded from repo selection).
3. Backoff: kick 500 ×2 then 200 → `next_attempt_after` set, claim filter skips, fake-timer advance → succeeds; 429 does NOT set backoff; `attempts >= 8` still dead-letters with backoff spread; incident characterization test with backoff OFF.
4. Settle CAS: two concurrent `_refreshRagIngestion` with `promoteGraph` mocked → exactly 1 settle.
5. Progress-write atomicity: conditional write sees `rag_drain_active` false → 0 rows updated → no 'draining' resurrect.
6. **Preservation suite** (must stay green): import never enqueues; unarmed-repo invisibility; WS5 always-retract; timeout dedupe; empty-graph refusal; callback idempotency; reaper claim-stamp semantics; G-2/G-3 reset-branch now reachable and correct.

**Integration / chaos (real ArangoDB — no testcontainers in repo):**
7. **No double-claim across two workers**: two node processes, one DB, 50 rows, N concurrent claim cycles → disjoint claim intervals; deliberate 1200 storm (4 workers × same head) → 4 distinct rows claimed.
8. Crash chaos: SIGKILL mid-wait → stale claim reclaimed after JOB_TIMEOUT by the survivor; settle still fires (reconcile + CAS).
9. **Live soak repro**: arm a ~1000-concept repo, then a 2-concept repo; acceptance: the small repo settles < 15 min with `fair` enabled.

## 8. Rollout

1. **Merge with defaults unchanged** (`fifo`, backoff off, cap 0): live changes = two indexes, settle CAS (single-worker no-op), atomic progress write (strictly safer), F-2/F-3 bug fixes. Full jest suite green. dataprep F-1 rides as its own small fix.
2. **Enable on validation**: `OKF_CLAIM_STRATEGY=fair`, `OKF_REPO_INGEST_CAP=2`, `OKF_KICK_BACKOFF_BASE_MS=60000` (matching concurrency 4-6). Run the soak repro + a normal publish→ingest→retract→re-ingest cycle.
3. **Soak criteria (72 h)**: no double claims (dataprep logs free of duplicate-fileId completion storms); zero reaper dead-letters on healthy rows; last-armed repo settles ≤ 15 min after arming while a mega-repo drains; settle records honest; lane utilization < slots (no 429 storms).
4. **Promote** via the standard forward-port path; flip the code default to `fair` only in a later release, after the soak, keeping `fifo` as rollback.
5. **Rollback**: set `OKF_CLAIM_STRATEGY=fifo` + backoff off — no data migration either way (`next_attempt_after` / `settle_claimed_at` are null-tolerant additions).

## 9. Open questions

1. Should `OKF_REPO_INGEST_CAP` become per-repo (repo field, Studio-settable) in v2?
2. Weighted (tenant-priority) fairness — deferred; round-robin satisfies the bounded-wait goal.
3. Whether the dataprep flock slot pool should ever split OKF vs legacy reservations (today's shared pool couples them; accepted).

## 10. Bug-issue cross-references

The incident's concrete bugs are filed as standalone issues (fix together with this spec's implementation):

| Issue | Defect |
|---|---|
| [#1021](https://opensource.unicc.org/un/itu/genie-ai/-/issues/1021) | F-1 / G-7 — dataprep kick 500 on long concept ids (ENAMETOOLONG), deterministic |
| [#1022](https://opensource.unicc.org/un/itu/genie-ai/-/issues/1022) | G-2 — graphExists pre-flight missing `await` (dead reset branch, jest-stub-masked) |
| [#1023](https://opensource.unicc.org/un/itu/genie-ai/-/issues/1023) | G-3 — graph-missing reset writes dotted keys (flat-attribute reset never lands) |

## 11. Appendix: measured load analysis (UK vs Indonesia, 2026-09-26)

| Metric | UK gov crawl | Indonesia History–LLM |
|---|---|---|
| Concepts | 997 | 999 |
| Avg body | 6,312 B | **112,393 B (~18×)** |
| Total content | 6.0 MB | **107.1 MB (~18×)** |
| Chunks/concept (chunk size 500) | ~9.8 | **~155 (~16×)** |
| Projected chunks | 9,794 (measured) | ~155,000 |
| Worker timeouts (16 h) | 0 | **17** (0.5–1.7k-chunk pages exceed the 30-min job window → restart-from-scratch churn) |
| Concepts/min over the drain | ~2–5 | ~0.5 |
| Wall-clock | ~6 h | ~40+ h projected |

**Conclusion**: the ~10× wall-clock difference is content-driven — chunk count is the
true load unit. Any capacity planning or ETA math for OKF drains should key on
**chunks**, not concepts; and the G-10 timeout-restart churn compounds the tail on
chunk-heavy corpora.

## 12. Review-hardening round (2026-09-26, max-effort code review)

Fifteen findings; fourteen fixed in the same-day hardening commit. The two
stand-outs are exactly the class the review exists to catch:

- **#1 CRITICAL — settle CAS UPDATE had no RETURN clause.** AQL
  data-modification queries return rows only via `RETURN NEW/OLD` — `.all()`
  was always `[]`, so on real ArangoDB every settle would read "lease not
  acquired" and **no drain would ever settle**. The arango-mock fabricated a
  matched row for that query shape and every test stayed green (the same
  stub-masked-production pattern as G-2). Fixed: `RETURN 1` makes
  `.all().length` the matched-row count.
- **#2 — the awakened G-2 reset fired on the routine fresh-drain path.** A
  repo's graph does not exist until dataprep's first kick (and retract drops
  it before every re-drain), so with N lanes every sibling lane saw "graph
  missing", nulled each other's claims, and re-claimed kicked rows → the
  duplicate-kick/WS5-retract storm. Fixed: the reset now requires PROGRESS
  EVIDENCE (`rag_ingestion.concepts_done > 0`) — a missing graph is normal
  until work has been recorded, and a lie only once it has.

Also fixed: #3 4xx kicks no longer parked (the catch path now gates on
response status — axios throws on every real 4xx/5xx, so the old "5xx-only"
gate in the non-throwing branch was dead code); #4 `ingest_attempts` +
`next_attempt_after` joined the shared claim projection (the backoff
exponential was flat at 2^0 — tests had injected the field the production
KEEP omitted); #5 the reaper's claim-age grace covers the max adaptive
window; #7 the fair pick skips repos with zero claimable rows (`claimable
= SUM(...)` aggregate — no more all-lanes-idle when the winning repo is
fully in-flight); #8 an expired park is liveness-probed at claim time
before the WS5 retract (a still-running task is deferred again, never
retracted); #9 a content change clears a stale park + claim (an edited
concept was invisible up to one window); #10 a lost settle lease is a
delegated success ONLY when `ingested_at` proves a settler completed —
else an honest 409 `SETTLE_BUSY`; #11 dataprep's task-registry done-callback
pops only its OWN registration (an old task's completion no longer deletes
a re-kicked task's entry — the probe now stays truthful); #12 both
lifecycle "complete fresh record" writes null `queue` (deep-merge leak);
#13 the settle lease is released if the flags flip throws; #14 the reset's
record write is the fused conditional MERGE (no JS read-modify-write); #15
the lane cycle cap gains a 60 s margin over the max window.

**Not fixed, by analysis (#6)**: the calibration finding is arithmetically
right (sub-240-chunk concepts clamp to the 30-min floor) but its conclusion
overreaches — the 17 observed timeout loops were all ~0.5–1.7k-chunk pages,
well past the floor, so adaptive mode engages exactly for the victims.
Sub-240-chunk concepts keeping today's window is the intended default-safe
behavior; operators tune `OKF_JOB_WINDOW_FLOOR_MS` / `SEC_PER_CHUNK_MS`
after the §8 soak calibration.

Cleanup notes below the correctness cap (follow-ups, not blockers): the
claim-filter triplication across strategies, the 5-round-trip refresh, the
fair full-COLLECT scan per claim, the mock's string-sniffed CAS stub,
`settleLeaseMs` vs `parsePositiveInt`, stale `_repoQueueDepth` gauge entries.
