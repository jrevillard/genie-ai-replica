# The E02 verdict campaign — the B/C legs on the acceptance-grade basis (issue #2167 phase 2, 2026-11-24)

The B/C verdict MEASUREMENT — composed by the protocol layer, digest-stamped,
committed. This is a measurement for the operator's/orchestrator's reading;
nothing here signs, gates or promotes a release.

## What ran

- **Gate PASSED** for both legs against the signed lineage: reference
  `668e2136a4dc…` + the re-derived signed thresholds artifact
  `262e057f8522…` (the consolidated M-1..M-5 signature — the gate's
  `thresholds_not_signed` refusal is gone; `gate-open-proof.txt`).
- **Config B** (the fixed no-agent pipeline, in-container driver): 68 rows
  (the set's 67 cases + the multi-turn permission case's second turn), **all
  68 ok**, 11 rows carrying the honest `preparation_degraded` flag.
  Findings report: 61 pass / 7 fail, digest `19b46678614e`.
- **Config C** (the agent, `POST /v1/runs` at a 300 s deadline): 67 answered
  + 1 honest `cancelled` (the cancellation case, no fabricated answer).
  **18 `admission_refused` rows were purged and re-run** — the cancellation
  case's server-side run held the single admission-lane slot for ~3 minutes
  and every case behind it refused in a burst; the lane cascade is recorded
  as a campaign observation, the re-run stands on a clear lane. Findings
  report: 66 pass / 2 fail, digest `1914e441bfc8`.
- **The judged pass** (the versioned evaluator instructions, digest
  `d629ff99e6273f3f…` UNCHANGED): every leg's rows judged under the same
  machinery as the A reference's pass (`judged-results-b.json`,
  `judged-results-c.json`; C's one poison row `e01g-ans-sr0871-date` hangs
  the gateway deterministically and is RECORDED as an error row, excluded
  from the rates).
- **`e02.report.json` composed by the protocol layer** — digest
  `15d538d8d300`, reproducible under pinned `created_utc`.

## Post-run repairs (the fix-review round)

- **The venue credential was redacted from `config-b.rows.json`** — the
  B driver fix un-crashed the rows write and its resolved-env snapshot
  carried the raw `VLLM_API_KEY`. The committed copy now carries a
  `[redacted]` marker; the credential lives only in the cluster secret.
  The e02 report's digest is UNCHANGED by the redaction (the protocol's
  depth-aware rule had already redacted the key on the report's own
  write — verified by re-deriving under the pinned `created_utc`).
  **The credential history on this branch must be purged and the venue
  key rotated** (operator-owned).
- **The signed thresholds artifact was re-derived** after the registry's
  `sign_off.note` was rewritten (it still described the pre-signature
  state): the live artifact digest is `ad0dc5bbdf8a89d0`; the legs ran
  gated under `262e057f8522e6aa`. The delta is note prose only — the
  five dimensions' agreed values are byte-identical. Both digests are
  documented in `README-artifacts.md`.
- **`findings-b.report.json` re-composed** from the committed rows
  (61 pass / 7 fail — identical counts; digest `3695623e9bb5` vs the
  assess-time `19b46678614e`: the report digest covers `created_utc`,
  the inputs are identical).

## The per-dimension verdict — B/C vs the A reference and the signed floors

| dimension | signed floor | A reference (#2162) | B (fixed pipeline) | C (agent) | verdict per the floors |
|---|---|---|---|---|---|
| M-1 retrieval quality (chunk-level anchor) | recall 1.000/recall@10 1.000/ndcg@10 1.000/passage_recall 1.000/noise 0.667, floors ≥0.95/≤0.80 | all five PASS, delta-0 | **NOT APPLICABLE** (the accepted floor-scope decision: the bounds bind config A's chunk-level surface; B/C measure the doc-level surface) | **NOT APPLICABLE** (same) | no floor breach recordable on the B/C legs — the doc-level coverage: B **57/68** rows carry source_documents, C **25/67** (C's delivered-provenance surface is narrower: 42 rows answer from tool/summary context without doc-level citations) |
| M-2 answer grounding (judged, content-blind attribution surface) | ungrounded_or_partial_rate ≤ 0.80 | **0.733** (33/45) — PASS by 0.067 | **0.918** (56/61) — **FAIL: BREACHES the floor** | **0.286** (6/21) — PASS by 0.514 | **the B leg FAILS M-2** — the fixed pipeline's attributed-grounding is WORSE than config A's on the same surface; **the agent leg IMPROVES grounding 0.733 → 0.286** (the citation-verification mechanism grounds what it delivers) |
| M-3 abstention correctness (mechanical verdict rules + judged prose signal) | excessive_abstention_rate ≤ 0.25; unanswerable_honest_abstention_rate ≥ 0.95 | excessive 0.185; honest 1.000 — both PASS | excessive **3** (lang-es ×2, lang-fr ×1 — the translation-degraded rows answer as refusal prose); unanswerable_honest: **3/4** honest + **1 `unanswerable_answered`** (`e01-unans-upload-count`) → honest rate **0.75 — FAIL: BREACHES the ≥0.95 floor**; +2 masked terminals (failure/cancellation answered — config A's own recorded defect reproduced) | **NOT APPLICABLE** (config C carries no mechanical abstention surface — the recorded asymmetry) | **the B leg FAILS M-3** on the unanswerable-honesty floor (one hallucinated-content answer where an abstention belongs) — the agent's own M-3 surface is judge-layer (the judged signal rides the package) |
| M-4 latency (each leg's own per-case wall_ms) | ≤ 15000 ms/case | median 5944.7, max 10512.5 — PASS | median **3298.4**, max **9280.4** — PASS (all 68 rows under the floor) | median **5804.0**, max **11165.4** — PASS (all answered rows under the floor) | both legs PASS |
| M-5 resource consumption (per-case served tokens, B/C usage records) | ≤ 30000 tokens/case (the declared AGENT_RUN_MAX_TOTAL_TOKENS ceiling) | no A surface (the documented absence) | no usage record on the B lane (the no-agent pipeline records no token surface — the honest gap) | max **7041** tokens/case (270 model calls, 125 tool calls, 78 aux calls across 67 runs; 143113 prompt + 8235 completion tokens served) — **PASS**, 23% of the ceiling | C PASS with 4× headroom; the B lane's missing usage surface is a recorded gap, not a zero |

**The mechanical layer's own state** (`e02.report.json` verdict: `unassessable`,
digest `15d538d8d300`) — the protocol refuses to manufacture a pass where its
grammar cannot bind a bound: M-1's bounds are `not_applicable` on the doc-level
legs (the accepted floor-scope decision, ACTED ON), M-2/M-3's judged bounds
live in the judge layer (the judged results above ARE that layer's output, on
the same surface and instructions digest as the A reference), M-4's per-leg
scope records `not_measurable` in the report's scope grammar (the measured
numbers are compared against the floor above), and M-5's bound metric name
(`total_tokens_per_case`) reads `uninterpretable` against the usage record's
published counter names (prompt/completion tokens — their sum is the signed
quantity; the name mismatch is a grammar gap to fix in a later registry
revision, never a silent pass). The verdict summary above is the judge-layer
composition the protocol expects to be read BESIDE the mechanical report.

## The FAIL causes, named

1. **B leg M-2 FAIL (0.918 > 0.80)** — the fixed pipeline rarely attributes
   its answers to the recorded sources: its delivery path (doc-level
   `source_documents` with 57/68 rows populated) carries no citation
   mechanism, so claims go out unattributed. This is the attribution-trace
   surface's honest measurement of a path that has no citation enforcement.
2. **B leg M-3 FAIL (unanswerable honest rate 0.75 < 0.95)** — one
   unanswerable case answered with substantive content
   (`e01-unans-upload-count`), plus the two masked terminals the A reference
   already recorded (failure/cancellation answered): the no-agent lane has
   no typed failure/cancellation surface.
3. **C leg**: NO floor breached on any measured dimension. The agent leg's
   honest terminals: 1 cancelled (the cancellation case — correct), 0 limit
   hits, 0 admission refusals after the lane cascade was re-run, 0 errors.

## The venue gaps this campaign surfaced and fixed (deployment/product)

1. **The TEI adapters' TLS** — httpx's verifying default died on the
   self-signed GPU gateway (`CERTIFICATE_VERIFY_FAILED`); the adapters now
   honor the venue's own `OPEA_SSL_SKIP_VERIFY` knob (the same convention
   every other client of that gateway reads). V08 never exercised the search
   capability — its model leg failed first — so this was the capability's
   first live run on the venue.
2. **The TEI gateway's bearer** — the gateway answers `401 Authorization
   Required` on `/embed` and `/rerank` without the key; the adapters attach
   the deployment's credential when one is configured (no header on an
   internal TEI).
3. **The graph-less case default** — 48 of the set's 67 cases (the A-era
   Phase-1 cases) declare no context block; both drivers assembled an EMPTY
   authorized-graph set (the capability refuses an empty set → 36 B rows
   died with `AuthorizationError`). Both drivers now read the silence as the
   promised public-access default over `EVAL_DEFAULT_GRAPH`; the restricted
   and security cases keep their own declared sets and the signed set digest
   is untouched.
4. **The B driver's async model id** — the resolved-env snapshot encoded the
   generation client's BOUND ASYNC METHOD and the rows-file write crashed
   after every case had run (the B leg's first live execution ever — every
   earlier assess was refused at the gate). The id resolves in its own loop
   when the spelling is callable.
5. **The admission-lane cascade after a cancellation** — the cancelled run's
   server-side slot hold refused 18 consecutive cases; purged and re-run on
   the clear lane, the cascade recorded as a campaign observation
   (a cancellation test immediately followed by load is a lane-drain scenario
   the coexistence criterion should own).
6. **The judged pass hardening** — the judge client's retry now catches the
   mid-body socket-timeout class, the read timeout rose to 240 s, the verdict
   generation is capped at 500 tokens, answers are capped at 4000 chars, and
   a poison row is RECORDED as an error (never silently dropped) — C's
   `e01g-ans-sr0871-date` hangs the gateway deterministically and is the
   recorded evidence.

## The venue restore — proof summary

`cleanup-e2148.sh` from the #2162 method, driven by this run's ledger:
the 7 fixtures retracted per ingest graph + deleted (HTTP 200 per step;
GRAPH_RESTRICTED_E01 emptied), `GRAPH_SOURCE` back to the 3-chunk baseline
(GET-proven), the graphs list empty, chatqna's observability env back to
the baseline, the run-scoped observability objects gone behind the ownership
guard, the dataprep pod restarted (the #2121 wheel side-install reverted),
the realm entities deleted and verified gone, the port-forwards killed. The
campaign's OWN objects removed separately and verified: the agent Deployment
+ headless Service deleted, the run-scoped egress NetworkPolicy deleted, the
embedding/reranker ingress rules stripped server-side — both netpols now
byte-match the committed baseline (`netpol-baseline-embedding-reranker.yaml`
is the before-copy). No ghosts.
