# OKF Testing Lab — probe scripts (salvaged 2026-10-08)

Reference implementations from the Story 1.3 calibration and the 1.6/1.8
tag-routing experiments. They lived as untracked scratch in the local
build root (C:\Dev\builds\main) and were salvaged into the repo so the
next build re-sync cannot destroy them. They are NOT wired to CI.

| Script | What it does |
|---|---|
| `probe1.3.py` | Deploy smoke probe: embeds via the remote TEI (https://ai.assembly.govstack.global:444/embed, Bearer VLLM_API_KEY) and calls the retriever `/v1/retrieval` directly with a 9-graph carrier |
| `routing_probe.js` | Asks Arango (localhost:8529, `_db/genie-ai`) what the current routing would select for several bali queries |
| `routing_probe2.js` | Deterministic synthetic-embedding bali routing demo (no live TEI) |
| `tag_dryrun.py` | Dry-run: LLM auto-tags 4 repos, then simulates routing for 4 user queries using ONLY the generated tags (the bali-misroute bug-class measurement) |

**Known fidelity gap (fixed in the 1-8 service, kept here for the
record):** these probes embed the RAW query without the BGE
query-instruction prefix. Production chatqna embeds WITH the prefix
(`Represent this sentence for searching relevant passages: ` —
`genie-ai-overlay/core/embedding_query_prefix.py`). The Story 1-8
`head-test-service.js` applies the prefix; numbers from these scripts
are therefore not byte-faithful to production routing.

The productized version of these experiments lives in
`components/okf-server/services/head-test-service.js`
(POST `/api/okf/repos/:id/routing-test`).

## Story 8-6 — RAGAS benchmarking lab

Added for the RAGAS benchmarking work (2026-10). The scripts above are
**read-only probes of the local build**; the ones below either read Arango
directly, drive a live benchmark, or repair stored state.

| Script | What it does |
|---|---|
| `smoke-8-6.js` | Live smoke of the whole RAGAS surface against the deployed stack (sidecar + okf-server + remote GPU judge) |
| `ragas-compare.js` | Re-runs an existing suite and compares the new run against the stored one |
| `ragas-diff.js` | Read-only row-by-row comparison of two runs: per-metric means, the answer-changed set, per-row deltas |
| `ragas-precision-analysis.js` | Read-only: why `context_precision` dropped between two runs |
| `ragas-probe.js` | Read-only shape probe — repos, suites, runs and their metrics |
| `ragas-row-inspector.js` | Read-only: the run-doc fields for named failing rows |
| `ragas-rescore-judge.js` | Re-score a **stored** run with a **different** judge (needs `x-ragas-secret`) |
| `ragas-compare-judges.js` | Read-only: compare a **finished** re-score job against the stored scores of the run it re-scored — the mean-per-metric table and the biggest movers |
| `ragas-abstention-backfill.js` | One-off repair: re-flag every stored run with the authoritative abstention detector |
| `trigger-explain.js` | Run **inside** the okf-server container: regenerate attribution + advisor advice for one run against the deployed code |
| `run-judge-baseline.js` | Read-only: the recent runs with their judge, row count and per-metric means |
| `row-peek.js` / `run-peek.js` / `run-results.js` | Read-only Arango views: rows of a run, newest runs of a suite, full summary of one run |
| `ragas-regenerate-reference.js` | Run **inside** the okf-server container: rewrite a suite entry's reference answer so it is grounded in the corpus VERBATIM, and write it only if `context_entities_recall` on the rewrite scores BETTER than on the original |
| `ragas-gate-audit.js` | Run inside the okf-server container: read-only — score a suite's ORIGINAL references with the same metric the regeneration gate uses, and list the ones the corpus cannot ground |
| `ragas-regenerate-entry.js` | Run **inside** the okf-server container: regenerate an ENTRY (question + expected passage + answer) against the published corpus, for the rows whose reference cannot be grounded at all. `--audit` lists which entries need it; `--judge env` picks the env judge (the suite's own judge cannot always drive RAGAS's synthesizer) |
| `ropc-verify-revert.js` | One-shot: mint a master token, force ROPC off, verify — the hardening the earlier harness left unchecked |

**Sidecar-internal scripts.** `ragas-rescore-judge.js` and `trigger-explain.js`
call the RAGAS sidecar / the deployed service directly and expect
`x-ragas-secret` (`RAGAS_INTERNAL_SECRET` / `OKF_INTERNAL_SECRET`). They are
dev tools, not part of the product surface.

## The group-scoped scenario (the fixture for a scoped Testing Lab)

`lab-scoped-scenario.js` builds the deployment state a **scoped** Testing Lab
run needs: repositories that are fenced behind a group, and principals whose
group memberships differ. It exists because the Lab's universe today is the
DEPLOYMENT's — it scores every repository head that competes, whichever
caller opened the run. A scoped evaluation has to be able to say "this
repository is OUTSIDE the evaluated set", and that can only be tested against
a deployment where the fences differ per principal.

**What it builds** (all in the target deployment's Keycloak realm):

| Piece | Name | What it is |
|---|---|---|
| fence A | the smoke repository | `acl.restricted = true`, held by `okf-lab-scope-a` |
| fence B | the repository an earlier grant already fenced | `acl.restricted = true`, held by `okf-lab-scope-b` |
| group A | `okf-lab-scope-a` | holds the scope-shaped realm role `okf:t:<fence A>:read` |
| group B | `okf-lab-scope-b` | holds the scope-shaped realm role `okf:t:<fence B>:read` |
| principal A | `okf-lab-principal-a` | member of group A only |
| principal B | `okf-lab-principal-b` | member of group B only |
| principal AB | `okf-lab-principal-ab` | member of BOTH groups — the union case |
| control | `okf-lab-principal-none` | no group — the scopeless caller |

The grants go through the PRODUCT's own facility
(`POST /api/okf/repos/:id/access/grant-group`), which creates the
scope-shaped realm role and assigns it to the group; a member of the group
carries that role in `realm_access.roles`, and the okf-server middleware folds
realm role names that are scope strings into the caller's effective scopes.

**The global scope mode is left at its default (`open`).** The per-repo fence
is what decides, and that is the posture the deployment runs in — flipping
the global mode would change the deployment's behaviour far beyond the test.

**Run it** (from the build root — it reads `.env`):

```bash
node scripts/okf-testing-lab/lab-scoped-scenario.js            # apply + verify
node scripts/okf-testing-lab/lab-scoped-scenario.js --verify   # verify only
node scripts/okf-testing-lab/lab-scoped-scenario.js --teardown # remove it all
```

It is idempotent, and it restores what it borrowed: the throwaway
tools-admin caller is deleted and direct access grants are put back the way
it found them.

**The verification is structural, not a name check.** The fence's graph name
is minted from the repository's name and version, so the script derives each
fence as the SET DIFFERENCE between the principal that holds it and the
control that holds none, and then asserts:

- the control traverses neither fence;
- a group holder traverses its own fence and NOT the other one;
- a member of BOTH groups traverses BOTH — the union — and the union is
  exactly `control + A + B`, strictly larger than either group alone.

**Credentials.** The principals' passwords are random and written to
`okf-scenario-credentials.json` in the build root — git-ignored, host-side,
never printed and never committed. Read them from there to log a principal
into the UI. Delete the file when the scenario is torn down.
