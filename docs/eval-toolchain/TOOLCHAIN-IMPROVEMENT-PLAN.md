# RAG Eval Toolchain — Improvement & Simplification Plan

**Scope:** `tests/rag-benchmarks/` (`eval/`, `scripts/`, `eval/gold_datasets/`, `eval/eval-reports/`, root scripts) in `release/el-salvador` / `main`.
**Source:** adversarial audit of 2026-10-06 — 30 findings verified (26 confirmed, 4 partial; refuted ones dropped). Every item below is backed by a verified finding; speculative work is quarantined in §5.
**Goal:** fully in-repo, silent-failure-proof, single-implementation toolchain the team never has to revisit.

## 0. Terminal architecture (decision record)

Today: three tool generations, a never-committed host-only orchestrator, three token fetchers, and a driver that exits 0 on every failure mode. Target:

```
scripts/run_anchor_with_cleanup.sh        # bash, thin: secrets from EVAL_DEPLOY_ENV .env,
  │                                       # ROPC enable + VERIFIED revert (trap), env exports
  └─ python3 eval/run_eval.py <mode> <gold> <out>
       ├─ eval/keycloak.py                # the ONLY token fetch (urllib, in-run refresh)
       ├─ eval/arango.py                  # the ONLY Arango client (paginated, counted, timeout)
       └─ per-entry containment + incremental atomic writes + exit-code contract 0/3/4
eval/run_ragas_eval.py + eval/requirements.txt   # pinned deps, in-repo compat stub, guards, cache
```

**Decision — delete `run_eval_chunked.py`, do not commit it.** It was never in git, and its entire failure class (fail-open chunk skip, unconditional `return 0`, last-chunk-only aggregate, hardcoded `/tmp/rag-eval/_chunks`) disappears if refresh + resumability live inside `run_eval.py`. Per-query incremental writes replace the one accidental benefit of chunking (partial outputs on crash). Findings 3/5/8/14 all converge here; "commit a hardened runner" (finding 8's alternative) is the fallback only if the fold slips a cycle.

**Explicitly rejected by verification — do NOT do:**
- Change `trace_found` scoring semantics for empty-selection spans (chatqna never emits that shape; would inject recall=0 false zeros into aggregates).
- Redesign outputs into `eval/out/`; ignore `gold_dataset*.matched*.json` (curated golds are tracked by policy — v4 must be *committed*, not ignored).
- calibrate sweep precompute restructure (measured 0.32 s for the full 480-cell sweep at real scale — no perf case; only the dedup kernel survives, see P1-4).
- Hard-refuse empty-context tuples in RAGAS (legitimate abstention outcome) — warn / opt-in `--strict` only.

**Implementation prerequisite (one read-only fetch session on the swarm node, before MR7/MR8):** recover `/tmp/rag-eval/run_ragas_eval.py` (exact vertexai stub + `bypass_n` shapes — a reinvented stub may miss symbols ragas imports), `gold_dataset.matched.v4.json`, and `/tmp/run_eval_chunked.py` (post-mortem reference only). Transcribe nothing from memory.

---

## 1. P0 — correctness / robustness / repo-integrity

**P0-1 — 401s silently absorbed as answers/tuples**
Problem: `drive_query` never checks HTTP status; an expired bearer turns the 401 body into `answer`, writes the tuple, exits 0.
Fix: append `-w '\n%{http_code}'` to the curl, strip before `_extract_answer`, return status; per-query `AUTH-FAILURE (HTTP 401)` warning (replacing the misattributed "check observability" hint); `n_http_errors` in the report; dump-tuples skips + counts HTTP-failed entries (never writes error bodies into `eval_tuples.json`); once P0-6 lands, abort-and-reauth on first 401.
Files: `eval/run_eval.py`, `eval/test_run_eval.py`. Effort: S.
Accept: unit test feeds a 401 body → no tuple emitted, non-zero exit, warning names auth; a dead-token live run fails in <1 min, not after 28 min of VT polling.

**P0-2 — no failure exit path**
Problem: `n_missed_traces`, `n_unmapped_chunk_keys` and zero-scored output never influence the exit code, so `set -e`, the runner and any CI treat fully degraded runs as success (today's n=0/exit-0).
Fix: contract 0 = clean / 3 = missed-or-unmapped above threshold / 4 = zero scored rows; threshold via `EVAL_MAX_MISSED_TRACES` (default small but >0 — post-deploy warm-up misses are documented expected behavior; `capture_baseline` sets it unlimited under `--allow-missed-traces`); surface the missed count on the dump-tuples path too.
Files: `eval/run_eval.py`. Effort: S.
Accept: all-missed anchor run exits 3; degraded dump-tuples exits non-zero; `--allow-missed-traces` capture still completes.

**P0-3 — one transient error kills a 25–40 min run with nothing written**
Problem: no per-entry exception containment, no retry, output written only after ALL entries.
Fix: wrap the per-entry loop in try/except (`TimeoutExpired`, `RuntimeError`, `JSONDecodeError` at the VT parse → treat as "not indexed yet", keep polling); retry ×2 with backoff, then a `{id, error, trace_found:false}` row flowing through the existing exclusion path; atomic re-write of the report after every entry (temp + `os.replace`) plus a JSONL sidecar of completed ids for resume; add `-m 50` to the VT curl.
Files: `eval/run_eval.py`. Effort: M.
Accept: `kill -9` mid-run → partial file valid and a rerun resumes (skips completed ids); injected VT HTML body does not crash the run.

**P0-4 — Arango cursor truncation (latent, deadline-bound)**
Problem: `cursor()` returns only the first batch (server default/`batchSize` 1000); the planned overlap=300 re-ingest pushes the corpus 850 → ~1080 chunks, past the threshold, silently deflating recall and misreporting previews as unresolved.
Fix: follow `hasMore`/`id` with PUT continuation, `count:true` accumulation assert, `timeout=30`, explicit batchSize; parameterize `cursor()` with url/db/user/password overrides (for P1-3). Current committed numbers are unaffected (850 < 1000) — fix **before** the re-ingest, and say so in the MR (not a retroactive fix).
Files: `eval/arango.py`, `eval/test_run_eval.py` (or new `test_arango.py`). Effort: S.
Accept: mocked two-batch cursor accumulates all rows; count mismatch raises; synthetic 1001-row collection yields a complete key map.

**P0-5 — the orchestrator exists only on the swarm host**
Problem: the committed wrapper (line 159) execs `run_eval_chunked.py`, which has never existed in git — fresh clone is broken, and the host copy is today's incident by construction.
Fix: after P0-3/P0-6, replace line 159 with a direct `python3 "$SCRIPT_DIR/../eval/run_eval.py" "$EVAL_MODE" "$GOLD" "$OUT"`; drop the now-dead bash token fetch + master fallback (lines 106–121); fix the wrapper docstring (line 12); retire the host copy (document in runbook).
Files: `scripts/run_anchor_with_cleanup.sh`. Effort: M (carried by P0-3/P0-6).
Accept: fresh clone runs the documented entry point end-to-end; `grep -r run_eval_chunked` → 0 repo hits; simulated mid-run kill → non-zero exit, no merged file written as success.

**P0-6 — token lifecycle implemented three times**
Problem: bash/curl master + realm fetch in the wrapper, python/curl per-chunk in the host runner, static `E2E_BEARER_TOKEN` in run_eval — the duplication is what let the runner be "recreated from partial knowledge".
Fix: new `eval/keycloak.py`: `fetch_realm_token()` / `fetch_master_token()` (urllib with unverified SSL context — replicates `curl -sk` for self-signed deployments; in-process, so no curl argv surface) and a `ropc_enabled()` context manager; run_eval gets opt-in in-run refresh (when `EVAL_KC_URL` + `GENIE_ADMIN_PASSWORD` are set → refetch at TTL−60 s or every N entries, updating `os.environ["E2E_BEARER_TOKEN"]`); static-token path preserved (capture_baseline passes no creds). Pick ONE fallback contract — recommended: drop master-token-as-bearer, keep realm ROPC + static override.
Files: `eval/keycloak.py` (new), `eval/run_eval.py`, tests. Effort: M.
Accept: 42-query run completes with zero manual token handling; unit tests on the refresh trigger; no password in any subprocess argv.

**P0-7 — ROPC revert can silently no-op**
Problem: `disable_ropc` reuses the 25–60-min-old admin token and the PUT is never verified — a failed revert prints "[cleanup] ROPC disabled" and exits 0, leaving the exact vulnerability the wrapper exists to prevent.
Fix: re-authenticate inside the trap before the PUT; `curl -sk -o /dev/null -w '%{http_code}'` requiring 2xx; retry ×3; on final failure print `FAILED to disable ROPC — DISABLE MANUALLY (client uuid=...)` and exit non-zero; apply the same status check to the enable PUT (fail before a 40-minute run against a closed gate).
Files: `scripts/run_anchor_with_cleanup.sh`. Effort: S.
Accept: expired-admin-token simulation still reverts; failed revert → non-zero ssh rc + loud message; failed enable aborts pre-run.

**P0-8 — secrets transit process argv**
Problem: master/realm passwords in curl argv (wrapper 98, 112; host runner 32–40), the full JWT in the `docker exec sh -c` argv on every query (run_eval 119–121), JWT in argv on the wrapper's later curls (122–136), and a 20-char token echo (121) — all ps-visible (today's incident #4).
Fix: wrapper token requests via `curl -K -` stdin config (command substitution + heredoc); JWT-carrying curls via a chmod-600 header tempfile deleted in the EXIT trap; run_eval drive_query → `docker exec -e E2E_BEARER_TOKEN <container> sh -c 'curl ... -H "Authorization: Bearer $E2E_BEARER_TOKEN"'` (valueless `-e` inherits the client env; single-quoted payload expands container-side; note the residual container-local expansion in a comment); delete the token-prefix echo, adopt length-only logging; keycloak.py (P0-6) removes the Python-side curl entirely.
Files: `scripts/run_anchor_with_cleanup.sh`, `eval/run_eval.py`. Effort: S.
Accept: `ps -ef` snapshot during a live run shows no password or JWT (spot-check procedure documented in the runbook).

**P0-9 — wrapper secret-resolution ordering bug**
Problem: the initial bearer fetch (l.107) runs before `GENIE_ADMIN_PASSWORD`'s `.env` resolution (l.156), so `.env`-only runs silently fall back to the master token; `KEYCLOAK_ADMIN_PASSWORD`/`ARANGO_PASSWORD` have no `.env` fallback at all.
Fix: hoist `EVAL_DEPLOY_ENV` resolution for all three secrets above first use (exported env still overrides; keep `:?` hard-fail after the fallback).
Files: `scripts/run_anchor_with_cleanup.sh`. Effort: S.
Accept: bare `ssh <host> 'bash -s'` with only `EVAL_DEPLOY_ENV` set takes the realm-ROPC path (no misleading fallback warning).

**P0-10 — the working RAGAS code lives only on the host**
Problem: `run_ragas_eval.py` crashes with langchain-community ≥0.4 (ragas eagerly imports the removed `vertexai` module); both fixes (sys.modules stub, `bypass_n=True`) exist only as node-local edits; no requirements pin anywhere; no empty-input guard.
Fix: recover both host patches verbatim and commit — stub behind `try: import langchain_community.chat_models.vertexai except ImportError:` executed before the first ragas import, `bypass_n` folded into the `evaluate()` call; add `eval/requirements.txt` pinned to the host-validated set (ragas==0.4.3, langchain-openai==1.6.4, instructor==1.17.0, openai==3.3.0, httpx, langchain-community per host state); exit 2 on empty tuples; loud stderr warning when embeddings are None / answer_relevancy dropped; add the `EVAL_JUDGE_MAX_TOKENS` knob; replace the unpinned install line in the header and doc touchpoints with `pip install -r requirements.txt`.
Files: `eval/run_ragas_eval.py`, `eval/requirements.txt` (new). Effort: S.
Accept: fresh venv from requirements.txt runs Phase 4 with zero host edits; n=0 tuples → exit 2 with message; dropped answer_relevancy prints a warning.

**P0-11 — gold v4 and the reproduction recipe are host-only**
Problem: the committed report's recipe references `gold_dataset.matched.v4.json` (untracked — breaks the never-lose-a-version policy), a third token mechanism (`/tmp/bearer_token.txt` refresher), an internal `user@ip`, and a literal password.
Fix: commit gold v4 into `eval/gold_datasets/el-salvador/`; rewrite report §10 to committed artifacts + the `E2E_BEARER_TOKEN` wrapper flow; `<user>@<host>` placeholders; drop the stale "modified locally on .102" note; extend `eval/.gitignore` with the run-output patterns only (`results*.json`, `anchor_*.json`, `eval_anchor_*.json`, `*_calibration.json`, `ragas_results.json`, `report_[AB].json`, `*.bak.json`, `*.json.tmp`, optionally `*.xlsx`) — **never** gold-dataset patterns.
Files: `eval/gold_datasets/el-salvador/`, `eval/eval-reports/2026-09-30-el-salvador-rag-comprehensive.md`, `eval/.gitignore`. Effort: S.
Accept: report recipe reproducible from a fresh clone; `git status` clean after a documented local run.

**P0-12 — capture_baseline: static 300 s token, no semantic gate**
Problem: N≥3 full runs + one ~28-min dump-tuples subprocess on a single ambient token; the anchor gate fires only after a wasted run, and nothing gates the tuples before RAGAS records them as baseline variance.
Fix: token provider (re-fetch when older than ~4 min, via keycloak.py) used by `_run_anchor_eval` AND the dump-tuples subprocess; semantic gate before ragas — count degraded-signature rows (empty contexts AND error-string answer, distinguishable from legitimate abstention), refuse above threshold unless `--allow` (not zero-tolerance on empty contexts).
Files: `capture_baseline.py`, `test_capture_baseline.py`. Effort: M.
Accept: simulated mid-capture expiry → refresh, clean tuples; >threshold degraded rows → refusal without `--allow`.

**P0-13 — dump_chunks identity defaults drift**
Problem: defaults `text`/`genieai_graph_SOURCE` vs the siblings' `chunk_text`/`GRAPH_TEST_SOURCE` → registry hashes computed over the *contextualized* text look valid but can never match eval-time hashes — a silently zeroed gold set (the documented Sept-23 incident class).
Fix: align to `GRAPH_TEST_SOURCE` + `chunk_text`; `chunk_text`→`text` fallback with a loud warning on empty read; document that `CONTEXTUAL_RETRIEVAL_ENABLED=false` deployments must set `ARANGO_TEXT_FIELD=text` for dump_chunks + match_gold_chunks + run_eval together; delete the wrapper's dead `TEXT_FIELD` line (66). Flag the behavior change: registries built on old contextualized hashes will not match.
Files: `eval/dump_chunks.py`, `scripts/run_anchor_with_cleanup.sh`, docs. Effort: S.
Accept: default `dump_chunks` on the live corpus produces hashes identical to run_eval's key→hash map on sampled chunks.

---

## 2. P1 — reuse / simplification / efficiency

**P1-1 — delete the legacy benchmark suite**
Problem: 2,543 lines (6 files) dead since the 2026-04-03 bulk import — `benchmark_query.py` raises NameError on import, all four scripts send the singular `categoryLabel` string that RequestContext's pydantic `extra='ignore'` silently strips (every run measures *unfiltered* retrieval), the service probe is structurally broken, zero references anywhere.
Fix: delete `benchmark_{config,ingestion,query,rag_accuracy,rag_performance}.py` + `run_benchmarks.sh`; update `site/content/en/docs/reference/source-tree-analysis.md:768-772`; MR description states latency/load testing is NOT replaced (venue: OTel trace waterfall) and offers `archive/` if the team objects. Also moots the hardcoded `root/test` Arango creds.
Files: 6 deletions + site doc. Effort: S. Accept: `grep -r benchmark_` → 0; CI green.

**P1-2 — one shared harness module**
Problem: `_docker_exec` forked between run_eval and capture_baseline (already drifting), plus ~15 hand-rolled JSON read/write sites with inconsistent `ensure_ascii`/`indent` and no `encoding="utf-8"` (locale hazard with Spanish text).
Fix: `eval/harness.py` with `docker_exec()` (container-in-error variant) and `read_json()`/`write_json()` (utf-8, indent=2, ensure_ascii=False; `default=str` only at the ragas report site); adopt across eval/ + capture_baseline (sys.path insert onto eval/). **Mandatory companions:** add `harness.py` (and `keycloak.py`) to `EVAL_IDENTITY_FILES`; update the scp/rsync recipe and scripts tables (ModuleNotFoundError class otherwise); re-capture the baseline afterwards (harness_sha changes — documented behavior).
Files: `eval/harness.py` (new), all eval scripts, `capture_baseline.py`, docs. Effort: S–M.
Accept: no `json.dump` outside harness (documented exceptions); all 82+ tests green; harness_sha covers the new modules.

**P1-3 — single Arango client**
Problem: three Arango implementations (arango.py; match_gold_chunks' private `arango_query` + re-resolved env defaults; benchmark_ingestion's root/test — dies with P1-1) and a byte-identical AQL pair inside run_eval.
Fix: `arango.source_chunks(graph_source, text_field, conn=None)` on the paginated cursor (P0-4); match_gold_chunks imports it while keeping its `--arango-*` CLI flags (defaults from the module); collapse run_eval's two builders into one fetch (pure DRY — they are mode-gated, no double fetch exists today).
Files: `eval/arango.py`, `eval/match_gold_chunks.py`, `eval/run_eval.py`. Effort: S.
Accept: exactly one `_api/cursor` implementation in the tree; match tests green.

**P1-4 — calibrate replay dedup (test-gated)**
Problem: the adaptive-selection formula exists twice (`score_combo` vs `_replay_recall_one`) and the copies have already diverged on unmappable rows; dead `tolerance` param; "20%" prose vs actual 30%; hand-rolled `_median`.
Fix: FIRST add a minimal regression test (synthetic report, hand-computed cell — calibrate.py has zero coverage); extract `replay_query` + `_selected_hashes` preserving the per-path unmappable semantics (skip vs 0.0 — do not silently change bootstrap numbers); `bootstrap_pair_ci` takes two cell dicts (preserve output JSON schema); delete the dead param; fix the prose; use `statistics.median`.
Files: `eval/calibrate.py`, new `eval/test_calibrate.py`. Effort: S.
Accept: new test pins both paths; `--check-baseline` replay unchanged on an existing artifact.

**P1-5 — match_gold_chunks write hardening + dead code**
Problem: default in-place mode writes non-atomically — a crash mid-write destroys the uncommitted manual-curation delta (the live working copies); dead `_WHITESPACE` + `import re`.
Fix: one-generation `.bak.json` backup (in-place only) + tmp + `os.replace`; ignore `*.bak.json`/`*.json.tmp` (P0-11); delete the dead constant and import.
Files: `eval/match_gold_chunks.py`, `eval/.gitignore`. Effort: S.
Accept: kill mid-write → original intact; no dead code remains.

**P1-6 — RAGAS incremental per-sample cache**
Problem: every invocation re-judges all tuples (10–30 min of judge time); any partial Phase-3 rerun forces a full re-judge of byte-identical samples.
Fix: `<out>.cache.json` keyed by sha256(question + contexts + answer + reference + judge model + temperature + embed model + sorted metric set + ragas version); judge only uncached samples; merge cached per-row scores; aggregate = column mean (all four metrics are row-independent); write new rows back immediately after `evaluate()` returns.
Files: `eval/run_ragas_eval.py`. Effort: M.
Accept: rerun with unchanged tuples → 0 judge calls, identical report; +8 tuples → only 8 judged.

**P1-7 — VT poll: immediate first check + backoff**
Problem: a fixed 5 s sleep before the first VictoriaTraces check is dead time on every query (≥7.5 min per 90-query run).
Fix: query VT immediately on entry, back off 1→2→5 s. Files: `eval/run_eval.py`. Effort: S.
Accept: healthy-run polls return on first check; worst case +1 s vs today.

**P1-8 — pipelined drive/poll**
Problem: strictly sequential POST → trace-confirm is the root of ~40 s/query (~60 min per 90 queries).
Fix: one producer thread drives the next POST while a poller waits for the current trace (single producer keeps POSTs serialized — zero added chatqna/GPU load); **prerequisite:** bound each query's span window to `[start_i − 5 s, start_{i+1})` — the newest-span selection would otherwise steal the next query's span.
Files: `eval/run_eval.py`. Effort: M.
Accept: A/B against a sequential run — identical per-query selections; wall-clock ≈ halved.

**P1-9 — (optional tail) capture_baseline module split**
Problem: 925 lines = pure stats + stack inspection + driver in one file.
Fix: extract `baseline_stats.py` + `stack_snapshot.py`, re-export moved names (tests keep passing); micro-cleanups (dead `repo_root` param, `statistics.median`, parity-branch collapse, one `_run_eval_subprocess` **preserving** the RuntimeError-with-stderr contract); do NOT blindly merge capture_semantic's loop (different skip-set). Files: `capture_baseline.py` + 2 new modules. Effort: M.

**P1-10 — (low impact now) match pre-normalization**
Problem: `find_matches` re-normalizes every chunk per preview (~250× redundancy; saves ~1–2 s today, dominant at ~10× scale).
Fix: normalize once after `load_chunks` with a fallback for bare dicts (keeps tests green). Files: `eval/match_gold_chunks.py`. Effort: S.

---

## 3. P2 — docs / runbook / CI

**P2-1 — unified RUNBOOK**
Problem: no Phase 0–5 procedure, no failure recovery anywhere; the CLAUDE.md Phase-3 recipe 401s today (no token); `EVAL_MODE=dump-tuples` is documented in no file; host-artifact layout is tribal knowledge.
Fix: `eval/RUNBOOK.md`, referenced from both CLAUDE.mds and README: Phase 0 pre-flight (pytest smoke, observability check, container resolution) → Phases 1–5 as exact commands (Phase 3 via the wrapper, `EVAL_MODE=dump-tuples`); post-run assertions before Phase 4 (`len(tuples) == len(gold.entries)`; anchor `n_missed_traces == 0` with the warm-up triage table); "when things go wrong": resume-from-sidecar, salvage partial outputs, merge command for tuple files, ROPC-left-enabled verification curl, chatqna warm-up wait; host-artifact inventory (`/tmp/rag-eval` layout, ragas venv, results — and that `run_eval_chunked.py` is retired). Demote the scattered copies to links (CLAUDE.md 495–543 and ~117–130; README Steps 2a/2b).
Files: `eval/RUNBOOK.md` (new), both CLAUDE.mds, `eval/README.md`. Effort: M.
Accept: a new operator runs xlsx → gold → match → dump-tuples → ragas from the runbook alone on a fresh clone, including one injected failure recovery.

**P2-2 — docs truth pass**
Problem: `eval/README.md` stale on seven counts (wrong `--mode` CLI, "NO OIDC", `categoryLabel` string, `*_chunk_ids` attrs, phantom `min_rank`, wrong TRACE_FLUSH_WAIT default, no xlsx_to_gold); root CLAUDE.md contradicts the auth gate in three places and teaches superseded manual batch slicing; `BEARER_TOKEN` vs actual `E2E_BEARER_TOKEN`; `match_status: ambiguous` never emitted; schema block missing passage/unmapped/hash fields; Layout tree omits test files, gold_datasets/, eval-reports/.
Fix: README → short pointer to eval/CLAUDE.md + two-path table; root CLAUDE.md → methodology only (delete the NO-OIDC claims, direct-run heredocs, manual slicing snippet); eval/CLAUDE.md = single operational source (fix env-var name, scripts table += keycloak.py/harness.py, TL;DR → `ssh <host> 'bash -s' <<'EOF'` heredoc with the ps-leak warning); statuses → resolved / resolved_split / unresolved / skipped_short (+ `--min-preview-len` 20 note); extend the schema block additively (incl. per-query vs aggregate passage-field naming); fix run_eval.py's own docstring (lines 17–18, 32, 38).
Files: 3 docs + `eval/run_eval.py` docstring. Effort: M.
Accept: `grep` for `--mode`, `NO OIDC`, bare `BEARER_TOKEN`, `ambiguous`, `min_rank` → 0 across the docs; every documented command runs verbatim.

**P2-3 — CI wiring**
Problem: zero `rag-benchmarks` references in `.gitlab-ci.yml`; 82 fast tests (~0.3 s, stdlib + pytest) run only when someone remembers — exactly how the legacy NameError survived.
Fix: one pytest job in the test stage covering `tests/rag-benchmarks/eval/` + `test_capture_baseline.py`; Phase 0 of the runbook references it.
Files: `.gitlab-ci.yml`, runbook. Effort: S.
Accept: MR pipelines run the suite; a red test blocks merge.

---

## 4. MR slicing (dependency order)

| # | MR | Items | Effort | Depends on |
|---|---|---|---|---|
| 1 | CI wiring (safety net for everything after) | P2-3 | S | — |
| 2 | run_eval failure visibility + exit contract | P0-1, P0-2 | S | 1 |
| 3 | Arango cursor pagination | P0-4 | S | 1 — **deadline: before the overlap=300 re-ingest** |
| 4 | run_eval resilience (containment / retry / incremental atomic writes) | P0-3 | M | 2 |
| 5 | keycloak.py + in-run token refresh | P0-6 | M | 4 |
| 6 | Wrapper rewrite: direct run_eval call, verified ROPC trap, secrets off argv, secret hoist — retires the host-only runner | P0-5, P0-7, P0-8, P0-9 | M | 5 |
| — | **Live validation gate on .102**: full wrapper-driven dump-tuples + RAGAS cycle (repo rule: nothing merges without a passing test) | — | — | 6 |
| 7 | Legacy benchmark suite deletion | P1-1 | S | — (parallel, anytime) |
| 8 | RAGAS pins + recovered host patches + guards | P0-10 | S | host-patch fetch; validated in the gate above |
| 9 | Gold v4 commit + report §10 + .gitignore | P0-11 | S | host fetch |
| 10 | capture_baseline token provider + semantic gate | P0-12 | M | 5 |
| 11 | dump_chunks defaults + fallback | P0-13 | S | — (before the next gold-build cycle) |
| 12 | Shared modules: harness.py + single Arango client | P1-2, P1-3 | M | 3; re-capture baseline after |
| 13 | match_gold_chunks hardening | P1-5 | S | 9 (ignore patterns) |
| 14 | calibrate dedup (test first) | P1-4 | S | 1 |
| 15 | RAGAS per-sample cache | P1-6 | M | 8 |
| 16 | VT poll backoff | P1-7 | S | — |
| 17 | Pipelining + span windows (A/B-validated) | P1-8 | M | 16 |
| 18 | RUNBOOK | P2-1 | M | 6, 8 (final command shapes) |
| 19 | Docs truth pass | P2-2 | M | 18 |
| 20 | *(optional tail)* capture_baseline split, pre-normalization, Python orchestrator | P1-9, P1-10, O3 | M | — |

---

## 5. Optional / flagged out of scope (not part of DoD)

- **O1 — out-of-scope-query burn (producer-side):** zero-doc queries emit no `reranker_selection` span (chatqna deletes the rerank node), so each burns the full 120 s poll and inflates `n_missed_traces`. Fix belongs in `genie-ai-overlay/chatqna` (emit the span with empty lists on the deleted-rerank path) or as skip-polling for `expected_chunks=[]` entries. Cheap in-toolchain half: a diagnostic-only `found` boolean distinguishing "span absent" from "attrs unreadable" — **no scoring-semantics change** (verified refuted).
- **O2 — production BFF flag (high value, cheap check, outside this toolchain):** `components/gov-chat-backend/services/query-service.js:428` sends singular `categoryLabel` on the multi-turn path — the same pydantic strip may deaden the *production* category filter. File a separate issue.
- **O3 — full Python orchestrator** (`scripts/run_anchor.py` owning the whole ROPC lifecycle) — only if the hardened bash trap keeps biting.
- **O4 — `archive/` instead of deletion** for the legacy suite, if the team wants browsability.

---

## 6. Definition of Done — whole toolchain

- [ ] Fresh clone runs the documented entry point end-to-end: `git ls-files` covers every invoked script; `grep -r run_eval_chunked` → 0; wrapper needs zero host-placed files.
- [ ] Silent-failure classes closed: any 401 / missed-trace-above-threshold / unmapped-key / empty hash-map / zero-row output → non-zero exit + visible counter (+ `.meta.json` sidecar on dump-tuples); a repeat of today's incident is impossible by construction.
- [ ] Crashed or killed runs leave valid partial output and resume; no 25-min run is ever lost to one transient error.
- [ ] ROPC is provably reverted on every exit path (re-auth + verified 2xx + loud manual-disable instruction on failure); tested with an expired admin token.
- [ ] No secret in any process argv: `ps -ef` during a live run shows no password or JWT; token-prefix echo gone; docs show only the heredoc/`.env` invocation.
- [ ] Exactly one token implementation (`eval/keycloak.py`), one Arango client (paginated, counted, timeout), one docker-exec/JSON harness module — all listed in `EVAL_IDENTITY_FILES` and the rsync set.
- [ ] `pip install -r eval/requirements.txt` on a fresh venv runs Phase 4 with zero host edits; n=0 tuples refused (exit 2); dropped metrics warn.
- [ ] Corpus >1000 chunks safe (pagination + count assert) — verified before the overlap=300 re-ingest lands.
- [ ] Gold policy holds: every eval report's matched gold version is committed (v4 in); `.gitignore` keeps the tree clean after documented local runs; gold writes are atomic with backup.
- [ ] Legacy suite deleted (~37% line reduction) or explicitly archived by team decision; site source-tree doc updated.
- [ ] One operational source of truth: `eval/CLAUDE.md` + `eval/RUNBOOK.md`; README is a pointer; no `--mode`/NO-OIDC/`BEARER_TOKEN`/`ambiguous`/`min_rank` references survive; every documented command runs verbatim, including one failure-recovery path.
- [ ] CI runs the rag-benchmarks pytest suite on every MR (existing 82 + new tests for status/exit/pagination/refresh/gate all green).
- [ ] capture_baseline captures complete (token-refreshed, gate-protected) baselines; harness_sha covers all behavior-affecting modules.
- [ ] A full live cycle on .102 (gold → match → wrapper-driven dump-tuples → RAGAS) has passed with the final code — the merge gate for the last P0 MR.