# W7 — the concept-document ceiling holds on every write path

**Status:** IMPLEMENTED (2026-11-06) — story written before code; the verification results are at the
end of this file.
**Source:** the plan-mode plan *"Oversized concept documents — derive the budget first, then split"*
(`~/.claude/plans/zazzy-sniffing-lobster.md`), sections §6 / §7 / §8 and requirement **R11** of
`_bmad-output/archived/okf-server/implementation-artifacts/concept-doc-ceiling-test-plan.md`.
**Branch:** **`feat/okf-concept-ceiling`, cut from `origin/main`** — NOT the CSR batch branch.
**Issue:** **#1576**. The deferred curator-initiated split (§6's second half) is **#1577**.

---

## Why this is the next slice

The ceiling initiative shipped its **import** half (§1 truncation visible, §2–§3 budget derived
from the served window, §4 one shared `OKF_MAX_CONCEPT_DOC_CHARS`, §5 lossless split at import,
§9 the config-validator parity check, §10 the real defects, §11 both audiences' docs). The
**curation** half never shipped. The archived test plan records the requirement and then ticks
the exit criterion that R11 is covered:

> `| **R11** | Editor save (`patchConcept`) over the ceiling → **409**, not a silent split | repository-controller.js |`
> `| **R11** | Editor save (patchConcept) over the ceiling → 409, not a silent split |`
> `- [x] R1–R13 each covered by ≥1 executed case`

**That tick is false.** Verified against the shipped code this session:

| Claim | Reality (2026-11-06) |
|---|---|
| R11 — editor save over the ceiling → 409 | **NOT IMPLEMENTED.** `patchConcept` (`repository-controller.js:1128-1244`) parses and writes with no length check; `patchConceptFields` (`concept-meta-service.js:986-1013`) composes the body with no length check. `CONCEPT_TOO_LARGE` exists **only** in `ingest-service.js` (the import path) and `ragas-suite-service.js` (an unrelated `CONCEPT_BODY_CAP`). |
| §7 — publish gate before `mintVersion` | **NOT IMPLEMENTED.** `lifecycle-service.js` has no ceiling reference at all (grep for `maxConceptDocChars` / `CONCEPT_TOO_LARGE` / `250000` → 0 hits). The publish path runs the count check (`:686-694`) then mints (`:710`) with nothing between them. |
| §8 — the curator is told the rule | **NOT IMPLEMENTED.** No `data-test-id`, no key and no component carries `chars / ceiling`; the frontend has zero references to the ceiling. |

And the archived plan's own decision of record makes the hole a defect, not a gap:

> **Decisions taken (David, 2026-10-14)**
> - Split during **import and curation, in both the wizard and the editor**.
> - **No oversized concept may persist by any path — split is required.**
> - Existing data is handled manually by David (retract → re-ingest → re-test). No migration phase here.

Today the editor is a path by which an oversized concept **does** persist: a curator pastes a
300 kB page into the body editor, autosave writes it, the concept row carries it, and the
ingest path later truncates it silently — the exact failure the whole initiative exists to
prevent. §7 is the backstop for that, and it also has to run **before** `mintVersion`, because
the mint is what creates state.

## The map that shaped the design (verified this session)

| Fact | Where |
|---|---|
| The one ceiling is `OKF_MAX_CONCEPT_DOC_CHARS`, default **250000** | `ingest-service.js:181-186` (`maxConceptDocChars`) |
| The import path splits on it, and **rejects** an unsplittable one | `ingest-service.js:209-241` (`applyDocumentCeiling`) → `IngestError('CONCEPT_TOO_LARGE', …, 400)` |
| The split runs **before** the concept-cap check, so expansion fails loudly | `ingest-service.js:743` (split) vs `:757` (cap check) — R8, already satisfied |
| The import response already reports what was split | `ingest-service.js:775` → `split_documents: [{ from, into, chars }]` |
| The editor's write path — the hole | `repository-controller.js:1128` `patchConcept` → `:1165` `patchConceptMeta` / `:1168` `patchConceptFields` |
| `patchConceptFields` composes body+frontmatter server-side and re-parses | `concept-meta-service.js:1004-1013` |
| The editor writes the **body** (frontmatter unchanged) or the **markdown** (frontmatter edited) | `ConceptEditor.vue:666-672` |
| The editor's save error is a bare boolean — it cannot say *why* | `ConceptEditor.vue:391` `saveError: false`; `:458-463` `saveStatusLabel` → `okf.editor.saveFailed` |
| The store swallows the server's error code | `store/modules/okf.js:918-921` → `code: 'PATCH_FAILED'` (every other action keeps `err.data.error`) |
| The house error envelope: `{ error, message }`, `err.code` becomes `error` | `okf-server/middleware/error-handler.js:30-40` |
| `error-handler` exposes the message for any status < 500, and for `code` matching `/^[A-Z][A-Z0-9_]+$/` | `error-handler.js:26-30` |
| A `LifecycleError` carries `code` + `status` and the publish gate already uses the 409 shape | `lifecycle-service.js:63-68`; the frontmatter gate `:790-802` |
| The publish path: count check → mint → export | `lifecycle-service.js:686-694` (count) → `:710` (`mintVersion`) → `:718+` (export) |
| The count check's own AQL shape (the gate's model) | `lifecycle-service.js:687-691` — `FOR m IN okf_concepts_meta FILTER m.repo_id == @repo_id …` |
| The ceiling is **not** exposed to the frontend anywhere | grep over `components/gov-chat-frontend/src` → 0 hits |
| `ragas-suite-service` reads the SAME var with a **different default (200000)** | `ragas-suite-service.js:103` — a real drift, tracked separately as #1205 |
| The lowest-level writer of `okf_concepts_meta.body` | `concept-meta-service.js:250-320` (`upsertConceptMeta`) — reached from import AND from every patch |
| **W1–W5 (the unmerged CSR batch) touches NONE of the functions this slice changes** | `git diff origin/main...origin/feat/okf-chat-source-w1` — the repository-controller hunks are `authzForService`, `getPiiConceptScan`, `getRepoManifest`, `discoverFromManifests`, `listConcepts`, `getConcept`; the lifecycle-service hunk is `armRagDrain`. `patchConcept`, `mintVersion` and the publish gate: **0 hits**. |

## Scope

Three changes, one invariant: **no oversized concept may persist by any path.**

### 1. R11 — the editor save refuses an over-ceiling body (409)

`patchConcept` measures the body it is about to write and refuses it over the ceiling.

- The **body** is what the ceiling governs (the import path measures `raw.body`, not the
  markdown), so the check is on the body in both modes: `payload.body` for a body patch, and
  the **parsed** body for a markdown patch (`parserService.parseConcept` already returns the
  split).
- **409**, `CONCEPT_TOO_LARGE` — mirroring the import path's `code`, and the plan's own
  "409, not a silent split".
- The message names the **concept**, the **size**, the **ceiling** and the **remedy** — the
  import path's message shape, which already names the section it could not split.
- The check sits **before** the write, so a refused save leaves **no row changed**.
- **Deliberately placed outside the `index` markdown carve-out** (the plan's own instruction):
  the `index` concept carries the repo's frontmatter YAML, and its markdown is *not* exempt
  from the rule.

### 2. §7 — the publish gate refuses an over-ceiling corpus, before the mint

`lifecycle-service` counts the concepts over the ceiling **next to the existing count check**
and refuses the publish with a `LifecycleError('CONCEPT_TOO_LARGE', …, 409)` naming the
offenders — **before** `mintVersion`, so a refused publish burns no version number and leaves
no half-created bundle. The plan is explicit about the placement: *"Place it before
`mintVersion` (:669), alongside the existing count check (:651-662) — not after the
frontmatter gate (:717), which runs after the version is minted and the bundle stored and so
rejects having already created state."*

- The offenders are **named** (concept id + size), capped in the message so a pathological
  corpus cannot produce a 10 kB error body.
- The gate mirrors the frontmatter gate's shape (`LifecycleError`, 409) — the house precedent
  for "a publish precondition failed".

### 3. §8 — the curator is told the rule, and told WHY their save was refused

Server-side errors are invisible to the curator today: the store flattens every failure to
`PATCH_FAILED`, and the editor's status line says only "Save failed — retry". A 409 that
arrives as "retry" is a **lie** — retrying an over-ceiling save fails identically forever.

- The store keeps the server's `error` code (the pattern every other action already uses:
  `code: (err && err.data && err.data.error) || '…'`).
- The editor names the refusal: the `CONCEPT_TOO_LARGE` case renders the server's message,
  which already carries the size, the ceiling and the remedy. Every other failure keeps
  today's "Save failed — retry".
- The editor shows the **live `chars / ceiling`** under the body editor (§8's editor
  advisory), so the rule is visible *before* the save rather than only after it.

## Acceptance criteria

| # | Criterion | Proof |
|---|---|---|
| AC1 | A body patch over the ceiling → **409 `CONCEPT_TOO_LARGE`**, and **no row is written** | okf-server test: the 409 carries the code + size + ceiling; the meta write spy is not called |
| AC2 | A **markdown** patch over the ceiling → the same 409, measured on the **parsed body** (frontmatter does not count against the ceiling) | okf-server test: markdown with a large frontmatter and a small body passes; markdown with a large body is refused |
| AC3 | The `index` concept is **not** exempt from the ceiling | okf-server test: an over-ceiling `index` markdown patch is refused |
| AC4 | A publish with an over-ceiling concept → **409 before `mintVersion`**, naming the offenders, and **no version minted** | okf-server test: `mintVersion` is not called; the message names the concept id + size |
| AC5 | A publish whose concepts are all under the ceiling is **unaffected** (the gate never fires on a healthy repo) | okf-server test: the publish proceeds |
| AC6 | The store keeps the server's error code — `CONCEPT_TOO_LARGE` survives to the caller | frontend test: the store action returns `code: 'CONCEPT_TOO_LARGE'` |
| AC7 | The editor renders the **server's message** for `CONCEPT_TOO_LARGE`, and keeps "Save failed — retry" for every other failure | frontend test: the two cases render differently |
| AC8 | The editor shows the live `chars / ceiling` under the body editor | frontend test: the counter renders the body length and the ceiling |
| AC9 | The ceiling the frontend shows is the **server's** ceiling — one number, not a frontend copy | the value rides the concept GET response (the server's own `maxConceptDocChars()`); no ceiling literal in the frontend |
| AC10 | All 14 locales carry the new keys, deep-key-identical | `localeConsistency.test.js` green |
| AC11 | okf-server + frontend suites green, **coverage not lower** than the measured baseline | jest --coverage before/after |
| AC12 | Security review on the full diff: no HIGH/MEDIUM | `/security-review` |

## Non-goals

- **No migration.** The plan's decision of record: *"Existing data is handled manually by
  David (retract → re-ingest → re-test). No migration phase here."* The measured blast radius
  of the publish gate is **one repository** (see below) — that is David's to re-ingest.
- **No curator-initiated split operation** (§6's second half). The plan lists it as the honest
  fallback for the ~4 % that cannot split automatically. It is a **separate, larger** feature
  (a new endpoint, a new UI surface, its own authz story) and it is NOT required for this
  invariant: the refusal names the size and the ceiling, and the import path already splits
  the same content on re-ingest. **Deferred, and it gets a backlog issue in this session.**
- **No change to the import path.** It already splits and already rejects.
- **No fix for the `ragas-suite-service` default drift** (250000 vs 200000). That is #1205 and
  it is a different var-semantics question; this slice must not widen into it.

## Measured blast radius (live, local build)

The publish gate refuses a publish **only** for a repository that actually holds an over-ceiling
concept. Measured against the running local build's `okf_concepts_meta`:

- ceiling in force: **250000**
- rows over the ceiling: **1**, in **1** repository

So the gate's live reach is exactly one repository — and per the plan, that one is re-ingested
by hand, which the import path splits. Recorded here so the number is not a surprise.

## Notes for the implementer

- **Where the ceiling lives.** `ingest-service.js:181` `maxConceptDocChars()` is the single
  authority. The patch path and the publish gate must **call** it, not re-derive it (the plan:
  *"two derivations are two things to drift"*). It reads `process.env` at call time — so a
  test can set the var and see the ceiling move.
- **Circular imports.** `ingest-service` ↔ `concept-meta-service` already reference each other
  and break the cycle with a **lazy** `require` inside the function (`concept-meta-service.js:945`
  requires ingest-service lazily). Follow that pattern if the patch path needs the ceiling.
- **The error code travels.** `error-handler.js` puts `err.code` in the body's `error` field
  and exposes `err.message` when the status is < 500. `httpService.handleResponseError`
  rejects with `{ status, statusText, data, message }` — **no `.response`** — so the
  frontend reads `err.data.error`. Note `err.message` in the envelope is
  `error.response.data?.message`, i.e. the server's message; the store must read the code from
  `err.data.error` (the pattern at `store/modules/okf.js:469`).
- **i18n.** 14 locales must stay deep-key-identical (`localeConsistency.test.js`). The
  `{n}`-style keys are consumed via `translate().replace()` — the **plain** `{x}` form is
  required there (`translateMixin` does a raw message lookup) unless the consumer file is in
  the test's `COMPILED_FILES` list. `ConceptEditor.vue` uses the mixin ⇒ plain `{x}`.
- **DS primitives only.** §8's advisory uses `DsCard` + `DsPill variant="warning"` +
  `DsButton`, per the plan's own pointer to `AutocorrectPanel.vue:40-90`. There is **no**
  `DsAlert`/`DsBanner`/`DsNotice` in the house kit — do not invent one.
- **Verbose structured logging** on every new branch (entry/exit, refusal, gate outcome).

---

# Implementation — the shipped result (2026-11-06)

## What landed

| File | Change |
|---|---|
| `components/okf-server/services/concept-ceiling.js` | **NEW** — the single authority: `maxConceptDocChars()`, `ConceptTooLargeError`, `conceptTooLargeError()`. |
| `components/okf-server/services/ingest-service.js` | The local ceiling function is gone; the module imports the authority and re-exports it under the historical name. The unsplittable-import refusal uses the shared class and keeps its **400**. |
| `components/okf-server/services/concept-meta-service.js` | **NEW** `listOverCeiling(repo_id, ceiling, limit)` — the publish gate's corpus read, in the module that owns `okf_concepts_meta`. |
| `components/okf-server/services/lifecycle-service.js` | The publish gate, placed next to the concept-count check and **before** `mintVersion`. |
| `components/okf-server/controllers/repository-controller.js` | `assertWithinConceptCeiling()` on both write modes of `patchConcept`; `getConcept` answers `max_doc_chars`. |
| `components/gov-chat-frontend/src/store/modules/okf.js` | `patchConcept` keeps the server's error code. |
| `components/gov-chat-frontend/src/components/okf/editor/ConceptEditor.vue` | The live `chars / ceiling` advisory and the server's refusal message. |
| 14 locale files | `okf.editor.ceiling` + `okf.editor.ceilingOver`. |

## Two assumptions the LIVE database corrected

Both were caught by measuring rather than reasoning, and both are now pinned by a test:

1. **The count query's row shape.** It had been recorded that `COLLECT AGGREGATE n = LENGTH(m)
   RETURN n` "emits `{n: 0}` on an empty stream and `{n: 0}` is truthy, which would refuse EVERY
   publish". **Measured against the running ArangoDB: both idioms return the SCALAR.**
   `COLLECT WITH COUNT INTO n RETURN n` answered `[9520]` on the corpus and `[0]` on an empty
   filter; `COLLECT AGGREGATE n = LENGTH(m) RETURN n` answered the same. `RETURN n` projects the
   collected VARIABLE, not a document — so `rows[0]` is the number itself and `rows[0] || 0` is
   right. The real trap is the **truthiness of a document-shaped row** — which is why the test
   now pins the scalar explicitly.
2. **The repo ids.** The corpus's `repo_id` values are **UUIDs**, not `r1`. The first probe
   (`repo_id == 'r1'`) matched nothing and returned `0` for every query — a silent all-clear that
   would have looked like a working gate.

## Measured blast radius (live, local build)

- ceiling in force: **250000**
- rows over the ceiling: **1** — `www-gov-uk-government-statistical-data-sets-unclaimed-estates-list`,
  **259063** characters, repo `b684b294-bf40-41aa-8ed5-1f809295dad1`
- so the publish gate refuses a publish for exactly **one** repository.

## Verification

| # | Criterion | Result |
|---|---|---|
| AC1 | Over-ceiling body → 409, **no row written** | PASS — the meta-write spies are asserted NOT called |
| AC2 | Markdown patch measured on the **parsed body** | PASS — a large frontmatter with a small body passes; a large body is refused |
| AC3 | `index` is **not** exempt | PASS |
| AC4 | Publish refused **before** `mintVersion` | PASS — `mintVersion` and `exportBundle` asserted NOT called; the repo stays `approve` with `version: null` |
| AC5 | A healthy corpus publishes unchanged | PASS |
| AC6 | The store keeps `CONCEPT_TOO_LARGE` | PASS — and the message survives |
| AC7 | The server's message for the refusal; "retry" for everything else | PASS |
| AC8 | The live `chars / ceiling` | PASS |
| AC9 | The ceiling is the **server's** | PASS — it rides the concept GET as `max_doc_chars`; no frontend literal |
| AC10 | 14 locales deep-key-identical | PASS — `localeConsistency.test.js` 10/10 |
| AC11 | Suites green, **coverage not lower** | PASS — (below) |
| AC12 | Security review: no HIGH/MEDIUM | PASS |

### Coverage — measured against the IDENTICAL tree

The branch had no commits when the baseline was measured, so `git stash` left `origin/main`'s tree
exactly — the comparison is tree-to-tree, not branch-to-guess.

| Component | Metric | Baseline | With the slice | Δ |
|---|---|---|---|---|
| okf-server | Lines | 88.71% | **88.83%** | +0.12 |
| okf-server | Statements | 87.12% | **87.24%** | +0.12 |
| okf-server | Branches | 74.42% | **74.62%** | +0.20 |
| okf-server | Functions | 88.38% | **88.53%** | +0.15 |
| frontend | Lines | 89.02% | **89.03%** | +0.01 |
| frontend | Statements | 88.98% | **88.99%** | +0.01 |
| frontend | Branches | 76.13% | **76.16%** | +0.03 |
| frontend | Functions | 67.24% | **67.26%** | +0.02 |

The okf-server numbers moved because two gaps were closed rather than opened: `listOverCeiling`
(7 statements — a new public function with no test) and the import path's unsplittable branch
(already uncovered at baseline, still uncovered). Both now have cases.

### Every new assertion was mutation-tested

A test that cannot fail proves nothing, so each new assertion was checked by reverting the
change and confirming the test goes red:

| Assertion | Mutation | Result |
|---|---|---|
| The store keeps the server's code | `code: 'PATCH_FAILED'` | red (`"PATCH_FAILED"` ≠ `"CONCEPT_TOO_LARGE"`) |
| The editor renders the server's message | `saveErrorMessage = ''` | red (`"Save failed — retry"` ≠ `"300000 characters"`) |
| The counter measures the BODY | count the whole markdown | red (the frontmatter case) |
| The count reads as a scalar | "any row means offenders" | red (3 of the 5 cases) |
| The import refusal's code + 400 | throw a plain `Error` | red (`undefined` ≠ `"CONCEPT_TOO_LARGE"`) |

### A defect the formatting gate introduced, and caught

`npm run format` (Prettier, 120 columns) wrapped the inline
`translate('okf.editor.ceilingOver', …)` call across lines. The i18n contract test extracts
referenced `okf.*` keys with a **per-line** regex, so the wrapped call became **invisible to the
guard** and the key's presence in the shipped catalogue stopped being checked — the frontend test
count dropped 3877 → 3876, which is what surfaced it. Fixed by hoisting the call into a computed
with the fallback in a module constant, so the key stays on one line. Both ceiling keys are now
extracted (verified with the contract test's own regex) and the count is back to 3877.

**This is a pre-existing sharp edge in the guard, not a defect of this slice:** 229 multi-line
`translate(` calls already exist in the OKF surfaces and are equally invisible to it. Every one of
them is an unchecked key.

## Deferred (with its issue)

- **The curator-initiated split operation** (§6's second half) — **#1577**. The refusal names the
  size and the ceiling, and the import path already splits the same content on re-ingest, so the
  invariant holds without it; but "split it into smaller concepts" is advice with no affordance
  behind it until that lands.
- **The 229 multi-line `translate(` calls invisible to the i18n contract extractor** — a gap in
  the guard, not in the keys. Worth a separate sweep; it is a guard-strengthening change, not a
  product change.

---

## Live verification (the local build, 2026-11-06)

The slice was deployed to the running local build (the tree synced to the branch, `okf-server` +
`frontend` rebuilt and recreated) and proven against real services, not only by unit tests.

### The smoke harness — `data/okf/smoke-test/run-smoke-ceiling.js`

A dedicated script in the harness family (it needs no fixture corpus; it creates and removes its
own repository and leaves no residue). **17/17 PASS, exit 0:**

| Property | Result |
|---|---|
| The concept read carries the server's ceiling | `max_doc_chars=250000` |
| An over-ceiling body → **409 CONCEPT_TOO_LARGE** | refused |
| The refusal names the size / the ceiling / a remedy | 250001 characters · 250000-character ceiling · a remedy |
| **The refused save wrote NOTHING** | the body is byte-identical afterwards |
| A body UNDER the ceiling still saves | 200 |
| Publishing a repo holding an over-ceiling concept → **409 CONCEPT_TOO_LARGE** | refused |
| The refusal names the offending concept | `legacy-oversized` |
| **The refused publish minted NOTHING** | version still `null`; no version stored |

The legacy corpus row (written straight into `okf_concepts_meta`) is the case the publish gate
exists for: a document imported before the ceiling existed.

### The harness is itself verified to bite

Pointed at a ceiling the server does not enforce (`OKF_MAX_CONCEPT_DOC_CHARS=100` for the harness
only — the server kept its full 250000 guard), it fails **6 assertions** and exits 1, including:

- `FAIL an over-ceiling body → 200 … (expected 409 CONCEPT_TOO_LARGE)`
- `FAIL the refused publish BURNED a version: null → 1`

A smoke script that cannot fail is not a smoke script.

### The four security questions, answered from the code

| Question | Answer |
|---|---|
| Is the new AQL bind-parameterised? | Yes — `@rid`, `@ceiling`, `@limit`; no value is interpolated into the query text. |
| Can the ceiling check be used as an oracle by an unauthorized caller? | No — `patchConcept` authorizes (`repoService.getById(..., {authz})` + `assertWritable`) **before** the ceiling check, and `transitionLifecycle` authorizes before `transition` (where the publish gate lives). |
| Is the server's refusal message an XSS vector? | No — it renders through Vue's `{{ }}` interpolation (escaped); there is no `v-html` anywhere in `components/okf/`. |
| Does the refusal leak anything? | No — it names the concept id, its size and the ceiling: all facts about a concept the caller is already authorized to read. `max_doc_chars` is a number. |
