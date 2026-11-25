# Testing Lab scoping — Agent Instructions

The OKF Testing Lab can be measured against **one principal's** retrieval, not only
the deployment's. This rule is the model, the tiers, and the traps — for an agent
who has to change this code without breaking a promise a curator relies on.

The authority is `resolveGraphSet({ okfScopes, isSuperAdmin })`
(`components/okf-server/services/scope-authz-service.js`). **One** authority:
scope grammar `okf:{tenant}:{repo}:{read|admin}`, plus the per-repo
`acl.restricted` fence. Never re-derive a caller's reach by hand.

## The objects

| Object | What it is | Where |
|---|---|---|
| **Evaluation Context** | A named, versioned, snapshot-resolved authorization principal — the union of a group's memberships, resolved through the ONE authority and FROZEN. | `services/evaluation-context-service.js` |
| **carrier** | The context's frozen set **narrowed to the CALLER**. A caller's carrier is never the context's set by default. | `carrierFor` / `narrowCarrier` |
| **binding** | carrier + `out_set` + the two comparison hashes. What a suite minted for a context carries. | `bindingFor` |
| **out_set** | What the caller MAY read that the context does NOT name. The abstention ("boundary") probes' source. | `bindingFor` |
| **pairing** | The statement that a suite and a run are about the same thing. | `services/evaluation-pairing-service.js` |

## The two comparison hashes — never the context version

`serving set` refreshes on the 30s TTL, and a re-built head moves the measurement
without moving the graph, so the context VERSION says nothing about comparability:

- `repo_set_hash` — over `(repo_id, graph_name)` (the serving set).
- `head_version_hash` — over `(repo_id, head_version)` (the head vectors).

Both are over the MEASURED set. A context's own hash is over its FULL frozen set,
so after a narrowing the two differ — they are named differently on purpose.

## The pairing tiers (`evaluation-pairing-service.js` → `pair()`)

| tier | condition | behaviour |
|---|---|---|
| `unbound` | the suite predates contexts | runs, DIAGNOSTIC — never comparable |
| `experiment` | a cross-context run, lifted by a recorded superadmin decision | runs, recorded, NOT comparable |
| `blocked` | **the under-test is not in the carrier**, or **more than half the pool is gone** | refused with 409, before a run doc exists |
| `ok` | same context, the subject present, the corpus still recognisable | runs |

Inside `ok`, two softer tiers, neither of which blocks:

- **skip-with-reason** — a ROW's dependency (the rival it cites, the repository it
  was minted from) left the carrier. The row is **not run**, is **counted** in the
  coverage, and carries the reason. Never silently dropped.
- **flag-only** — the carrier GREW (it holds repositories the suite never saw) or
  SHRANK (the suite's pool no longer holds). Either way: `comparable: false`.
  **Grow and shrink are the same failure of comparability, seen from opposite
  directions.**

### The two rules that are easy to get wrong

1. **Only the SUBJECT blocks.** The repository under test missing from the carrier
   refuses the run: there is no measurement. A pool member missing does NOT — the
   rows that depend on it are skipped and the run is scored over the rest, marked
   not comparable. (Before this rule, the pool check ran FIRST and the skip tier
   was dead code for its stated purpose.)
2. **The FLOOR.** `MIN_POOL_COVERAGE = 0.5` (David, 2026-11-23): past half the
   pool gone, the run is a DIFFERENT experiment, not the same one with holes, and
   it is refused with `pool_evaporated`. The refusal names the coverage it lost.

## The GENERATION is inside the context too

A suite minted for a context may only contain rows that belong to that context.
An invalid row is **never generated** — it is discarded at mint time, and the
generation loop asks again for the shortfall (exactly like the uniqueness rule).

- The prompt lists the carrier's repositories as a **CLOSED SET** of competitors
  and the excluded repositories as a **CLOSED SET** of abstention probes. The
  prompt says what happens to a name outside the set: DISCARDED.
- A confusable naming a repository outside the carrier is discarded.
- An abstention probe naming a repository the scope does NOT exclude is discarded.
- A benchmark question whose ground truth cannot be attributed to a context
  repository is discarded (`NO_ATTRIBUTABLE_QUESTIONS` if that empties the suite).
  Its passages are not in the evaluated corpus, so the judge would score a
  `context_recall` of ~0 — a FAILURE that is an artefact of the corpus, not of the
  system.

`intended_carrier` is **PROVENANCE**, not a subject label: `'in'` when the row was
minted from the carrier's pool, `'out'` when it was minted from the excluded one.
One rule, no per-class table.

## The boundary verdict

An `out` row asserts an ABSTENTION ("the under-test must NOT claim this"), not a
routing preference. The run counts `boundary: { total, evaluatable, held,
breached }`:

- `total` — the boundary rows in the run's scope (the POPULATION, including one
  whose routing leg errored — a boundary row that was not measured is a scope
  question left unanswered).
- `evaluatable` — the ones that produced a verdict.
- `held` / `breached` — over the evaluatable ones only. A row that was never
  evaluated can never be counted as "held".

`boundary` is `null` when there was no boundary row: the boundary was **not
measured**, which is not the same claim as "it held".

## The traps

- **The false pass.** A confusable whose rival is ABSENT from the carrier passes
  by the rival's absence. Never run such a row — skip it.
- **The false fail.** A benchmark question whose own repository is absent cannot
  retrieve its reference passages; the judge scores ~0 and files a FAILURE.
- **The quiet loss.** A suite that quietly loses its hardest negatives reports a
  better pass rate than it earned. That is why skips are COUNTED, why a run with
  skipped rows is `comparable: false`, and why the summary carries `n_skipped`
  and `n_total` beside `n_queries`.
- **The name, not the id.** A row's rival is resolved BY NAME against the
  snapshot; the carrier holds ids. A name the snapshot never knew cannot match →
  the row is skipped with the NAME as its dependency.
- **The positional skip index.** `pair()` returns `skipped_rows[].index` — the
  position in the array the CALLER passed. The caller must index the SAME array
  it hands in (`runSuite` builds `allRows` first and passes it).
- **A not-attempted row is not a failure.** A skipped row carries an `error`
  (that is how it records its reason), but it is never counted as a failed row,
  never retried, never answered, and it is its own bucket in the summary.
- **A refusal is not a measurement.** A blocked pairing writes NO run doc: there
  is nothing in the history. A run that is measured over a smaller corpus IS in
  the history, marked not comparable — which is strictly more useful than a hole.
- **The two superadmin powers.** Binding a suite to a context, and lifting the
  cross-context block, are DEPLOYMENT-WIDE powers — a context may name ANY
  repository. Both use the SAME predicate as the context write surface
  (`isSuperadminCaller`): the `tools-admin` realm role OR a wildcard
  `okf:*:*:admin` scope. A repo-scoped admin is NOT superadmin for either.
