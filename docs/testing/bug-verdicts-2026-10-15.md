# Bug verdicts — Bali live re-test, 2026-10-15

Verdicts for the issues whose fixes were **proven by live evidence** during the
Bali re-test on 2026-10-15. Ready to post as issue comments and close.

**Status: NOT YET POSTED.** The `glab api` note/close calls were blocked by the
local permission classifier, so the text lives here instead. Post verbatim and
close, or authorise the API call and I will do it.

**What is deliberately NOT here:** !1067, !1069, !1073, !1075, !1077, !1081,
!1082. Their fixes are deployed and mechanically verified, but the behaviour
has not been confirmed live. A verdict means proven; those do not have it yet.

---

## !1072 — ArangoDB 1202/1204 logged at error and re-thrown

**Verdict: FIXED — verified live on Bali, 2026-10-15.**

**What was wrong.** `isArangoNotFound` treated only ArangoDB 1202 (document not
found) as an expected absence. 1204 ("no match") — which `firstExample` throws on
a legitimately empty query — fell through to the generic branch: logged at
`error` and re-thrown by the retry wrapper. The throw is load-bearing across 18
call sites, so it could not simply be swallowed; the classifier had to be widened
instead.

**Fix.** `services/arango-errors.js` — `isArangoNotFound` now covers 1202 and
1204, with `isArangoCollectionNotFound` split out for 1203, which is a genuine
fault rather than an absence. `db-connection-service.js` gained
`_isExpectedAbsence` for the retry wrapper, which now logs at `debug` and still
re-throws, preserving the contract that 18 call sites depend on.

**Evidence — same repo, same operation, only the code changed:**

| | `firstExample` error lines |
|---|---|
| Import of 1,113 concepts, pre-fix image | **2,227** |
| Identical import path, post-fix image | **0** |

**Regression coverage.** okf-server suite: 1,268 tests / 52 suites green. The
first fix attempt failed 33 of them, because 1204 cannot be reproduced against the
arangojs mock — arangojs 10.1.2 removed `firstExample`, so the test has to raise
1204 directly. The regression test was then verified *falsifying* against the
pre-fix classifier.

**Residual risk.** None identified.

**Caveat worth recording:** CI has no `test:okf-server` job, so this 1,268-test
suite runs only on a developer machine. That gap is why the original defect
shipped, and it deserves its own item.

---

## !1065 — bulk-accept satisfies the publish gate scan-free, then reports zero hits everywhere

**Verdict: FIXED — verified live on Bali, 2026-10-15, with a before/after on the
same repo.**

**What was wrong.** `getRepoMetrics` returned `pii_hit_count` and
`broken_link_count` as *literals in the AQL projection*, and hardcoded both to
`0` again in the JS fallback. Neither was computed from the docs binding or
anything else, so both were structurally always zero — not stale, not a post-state
counter, not a computation that could fail.

**Why that matters more than a wrong number.** A curator reading the dashboard
could not distinguish a scanned-and-dirty repo from one nobody had scanned. For a
tool whose remedy is *keep-one-delete-the-rest*, reporting "clean"
unconditionally is the dangerous direction to be wrong in.

`broken_link_count` was **removed rather than implemented** — the product has no
broken-link concept anywhere, and `conformance-service.js:186-191` records that
decision explicitly. A fabricated zero is worse than an absent field.

**Fix.** `pii_hit_count` is now computed as *concepts carrying PII findings with
no resolution recorded* — the work a curator still has to action. `pii_state`
cannot express this on its own: it reads `clean` both before and after a bulk
accept, because accepting RESOLVES the findings rather than removing them.

**Evidence — observed live during the Bali re-test:**

| Moment | `pii_hit_count` |
|---|---|
| Before bulk accept | **1,113** |
| After bulk accept | **0** |

On the pre-fix image this read `0` throughout the scan, the accept, and after it.

**Residual risk.** `pii_hit_count` is a point-in-time read; a scan in flight will
under-report. Acceptable for a dashboard tile, but it is a read of current state,
not a scan ledger.

---

## !1080 — import throughput pinned at 4 concurrent PII scans on a 24-core host

**Verdict: FIXED as filed — the defect is gone and verified running. The
throughput improvement is NOT measured, and this verdict does not claim one.**

**What was wrong, as filed.** Import lanes and PII sidecar workers were two
independent knobs with a load-bearing relationship stated only in prose. The
shipped default (4/4) used ~18% of a 24-core host: measured PII at 443% CPU while
okf-server sat at 0.5% and dataprep at 0.2%.

**Fix.** The four lane variables are now one documented capacity setting with a
sizing table, a stated memory budget (~640 MB per PII worker, measured), a
recreate step, and a log line (`OKF import lane capacity`) that reports the values
and whether they are paired. Documented for three audiences with no duplication:
`site/content/en/docs/configure/okf-variables.md` for operators, `CLAUDE.md` for
the agent contract, and a new `.claude/rules/CAPACITY-SIZING.md`.

**Evidence — the defect no longer reproduces:**

| | before | after |
|---|---|---|
| Import lanes | 4 | **12** |
| PII workers | 4 | **12** |
| Drain lanes | 6 | **12** |
| Dataprep slots | 6 | **12** |
| Machine utilisation | ~18% | unmeasured |

The Bali import of 1,113 concepts completed in **21.7 min (51.3 concepts/min)**,
with 7 of 12 PII worker processes each measured at ~110% of a core
simultaneously — proving the pool genuinely fans out across processes rather than
queueing.

**Explicitly NOT claimed.** No like-for-like baseline exists. There is no
same-corpus 4-lane run, so the improvement cannot be quantified, and the 51.3
concepts/min figure is the only defensible number. A re-import at 4/4 on identical
input is required before any speed claim is made. (The documented 4.3 min/batch
figure in the old comments is a different corpus and must not be used as the
comparison.)

**Known limitation surfaced while fixing this.** The `paired` flag in the lane log
is a *configuration* check, not a contention gauge: it compares one import's lanes
to the sidecar's workers and cannot see other in-flight imports, and
`POST /:repo_id/import` has no guard against a concurrent one. Two concurrent
imports oversubscribe 2:1 and both still report `paired: true`. Tracked as
BUG-17 in `bug-triage-worklist-2026-10-15.md`.
