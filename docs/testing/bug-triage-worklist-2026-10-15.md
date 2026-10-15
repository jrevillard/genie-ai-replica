# Bug triage — prioritized fix queue

**Triage date:** 2026-10-15 · **Source:** issues !1060–!1081 raised during the
concept-document-ceiling test plan · **Status:** open work list, to be worked
after the Bali (Tier 3) drain is under way

The ordering is by **blast radius × whether the failure is silent**, not by the
P-labels on the issues. A P3 that silently returns wrong data outranks a P1 that
fails loudly.

---

## Wave 0 — do first: silent-wrong results

**Currently EMPTY.** The one item filed here, !1079, was demoted after
verification — see below. Do not reconstruct this wave without first
establishing that a failure is genuinely silent.

### ~0 · ~~Fail loud on ArangoDB cursor errors~~ — !1079 — **DEMOTED, premise falsified**

Filed as the highest-leverage Wave 0 fix on the premise that production queries
could silently receive an empty result. **That premise was wrong.**

`arangojs` — the driver every service uses — **throws** on an unquoted hyphenated
collection name:

```
UNQUOTED hyphen   -> THREW errorNum=1203
BACKTICKED        -> OK rows=1
CONTROL no-hyphen -> OK rows=1
```

AQL cannot reference `OKF_solar-system_v1_SOURCE` unquoted (the hyphen parses as
subtraction), but the driver surfaces that as a loud `1203`, which is correct
behaviour. The silent-empty is a property of **raw `POST /_api/cursor`**, where
ArangoDB returns HTTP 200 with `{"error":true,...}` and no `result` field. That
is how it was found — by diagnostic scripts, not by the application.

Reclassified as a **diagnostics footgun**: the error message names a *truncated*
collection (`OKF_solar`), which is genuinely misleading, and a non-throwing
client reads the absent `result` as an empty collection. Worth a quoting helper
and a note in `arangodb-collections.md`; not urgent.

**The lesson worth carrying:** I ranked this first off a raw-HTTP observation and
did not test the driver until afterwards. "Does the client throw, or return
empty?" is a one-minute check that would have changed the answer.

### ~0.2 · Graph collections named after the bundle — !1070 — **re-verify first**

`repo.graph_name` is `OKF_<uuid>`, and **UUIDs contain hyphens** — so "the named
collection reads empty" is very likely the same `1203` footgun rather than a
separate data-integrity defect. Check this before spending time on it; it may
collapse into the !1079 footgun above.

---

## Wave 1 — data entry blocked

Loud failures that stop a curator doing their job. Ordered by how much they block.

### 1.0 · ~~Suggester returns more tags than the API accepts~~ — !1082 — **FIXED** `5fd5adb`

**Was blocking curation outright.** `frontmatter.suggest` returned 22 entities
against a ceiling of 20, so the PATCH 400'd — and because Joi rejects the whole
body, every tag was lost, not just the two over the ceiling. Fixed by making
`TAG_LIMITS` an exported single source of truth consumed by both the validator
and the suggester, with drops logged and returned in `over_ceiling` rather than
silently truncated. Third ceiling in this area enforced on one side only, after
`type: index` (BUG-11) and `broken_link_count` (BUG-12).

### 1.1 · Frontmatter panel renders invisible in dark mode — !1069

Saved tags and fields load correctly and render as nothing — styles reference a
`--color-*` token vocabulary that does not exist, so the values resolve to
initial values. **The data is intact; it is only invisible**, which makes it
especially dangerous: an operator re-types values that were already saved.
Highest-severity item where nothing errors.

### 1.2 · `type: index` is written, accepted, then flagged INVALID_TYPE — !1077

**FIXED in `59ebfb1fc`, pending live re-test.**

The product writes `type: 'index'` on the bundle root (`crawl-conversion-service.js:709`),
accepts it as valid in `is_index` (`concept-meta-service.js:157`), then flags it
`INVALID_TYPE` against a 5-value enum that has no `index`. There is **no guided
remedy**, so a curator hits a wall. Two vocabularies maintained independently is
the root cause; the same shape produced BUG-12's enum drift.

Resolution: new `services/okf-vocabulary.js` as the single source of truth, imported
by all four consumers rather than restated, plus a guard test that fails if any
consumer re-introduces either literal. The reserved root types (`index`,
`BundleRoot`) are recognised but deliberately kept **out** of the autocorrect remedy
text — offering a recognised reserved type as a choice would be misleading.

The companion status-vocabulary disagreement also closed here, and **not** in the
direction first assumed: measured against the live corpus (2,979 concepts — 2,860
`draft` / 5 `stable` / 114 absent, with `active` and `retired` occurring **zero**
times) and against `concept-meta-service.test.js:304`, which asserts `retired` is
invalid, the correct list is `['draft','stable','deprecated']` — so
`conformance-service` was right and **autocorrect held the wrong list**, flagging the
`stable` concepts that really exist.

Verification: okf-server **49/49 suites, 1219/1219 tests**; 17 new cases in
`__tests__/okf-vocabulary.test.js`.

### 1.3 · Accepting one link suggestion unmounts all the others — !1075

**FIXED in `49499fecc` (Story 10.8), pending live re-test.**

Suggestions render *inside* the orphan issue row they remediate; accepting one
cures the orphan, the row unmounts, and every remaining proposal is destroyed.
Both panels now render at panel level keyed on `suggestFor` / `wireFor`.

Two things worth carrying forward from this one:

- **The orphan row also carries the "Suggest links" entry point**, so once the page
  has a link the row stops rendering — meaning the remaining proposals were not just
  destroyed, they were *unreachable*. The remediation path worked exactly once per page.
- **The original test mocked a static report**, so `refresh()` returned the same
  orphan forever and the unmount never happened. That mock is why it shipped green.
  Any test for a self-clearing UI must make the refetched report DIFFER.
- The pre-existing test's green result was not evidence of correctness here — it was
  evidence the mock was too weak to reach the defect.

### 1.4 · PII sidecar worker dies — !1060, !1063

Two linked issues, root cause still unknown (!1060), with a residual worker
death after scan completion (!1063). This one has consumed more time per unit of
progress than anything else in the queue. **Do not start it without a
reproduction** — it has resisted three attempts.

### 1.5 · Bundle-imported repo opens on wizard step 9 — !1067

**FIXED in `69983dbb2`, pending live re-test.** Closes the wizard cluster (1.2 → 1.3
→ 1.5).

Opens past the only step with a blocking requirement, with no cue that Curate
(where PII, frontmatter and cross-links are resolved) exists.

Two corrections to the filed analysis, both of which change the fix:

- **`lockedIndices` is not the mechanism.** It only locks nothing when `studio_step`
  is 9. The real chain is: the zip branch seeds no draft and navigates to the
  dashboard; the operator opens the repo **later** via a card click; `onResume` finds
  no persisted draft and takes the permissive `studio_step: 9` fallback at
  `StudioTab.vue:381`.
- **The filed one-line fix would not have worked.** Setting `activeDraft` is useless
  because the branch navigates away before the card click. Only a **persisted** draft
  survives — hence `okf/saveDraft`, matching the crawler path at `:671-682`.

**Wave 1 is now complete** (1.1 `!1065`, 1.2 `!1077`, 1.3 `!1075`, 1.5 `!1067`), with
1.4 (`!1060`/`!1063`) deliberately still parked for want of a reproduction.

---

## Wave 2 — operational and diagnostic

### 2.1 · 28 env vars documented but never reach a container — !1073

**FIXED in `4758e71f8`, pending live re-test.** Everything in Wave 0 and Wave 1 that is
configurable depended on this being trustworthy.

Setting them in `.env` is silently ignored — there is no `env_file:` anywhere in
docker-compose.yaml, so a variable absent from a service's `environment:` block is
unreachable by definition.

**26 wired, 2 deliberately not — and the 2 are a different bug.** All 28 confirmed
(64 documented `OKF_*`, 36 wired, 28 not); each service assignment made by grepping what
**reads** the var, not by its name. But `OKF_SEARCH_STYLE` and
`OKF_FRONTMATTER_TAG_BATCH_SIZE` are read by **nothing** — spec 1-6 assigns the first to
the retriever and the overlay never reads it. Wiring them would create
live-*looking* variables that change nothing, which is worse than the honest absence.
They sit in a named allowlist asserted to be exactly those two.

**Why CI was structurally blind, twice over** — both now closed:

- `parseEnvTemplate` skipped `#` lines, and `env` has **300 commented variable
  definitions against 61 active ones**. The knobs could not reach the orphan gate even
  in principle. They now parse into a **separate `documented` array** — merging them
  into `variables` would swamp every existing check.
- Nothing asserted the **env→compose** direction. **AC9** does now, and is proven
  non-vacuous and falsifying: 33 unwired pre-fix → **0** post-fix.

**AC10 added** because the same drift class keeps recurring: **22 `OKF_*` knobs are
documented twice in `env`** and nothing enforced agreement — the shape that produced
BUG-11, BUG-12 and BUG-15. Scoped to `OKF_*` on purpose; unscoped it flags 12
legitimate multi-context examples (local install vs remote GPU node).

### 2.2 · ArangoDB 1202 logged at error and re-thrown by the retry wrapper — !1072

**FIXED in `d79e37325`, pending live re-test.** Closes Wave 2's noise half.

24 error lines per 2 minutes on a *clean* drain. This is what trains operators
(and agents) to ignore error logs.

**The filed direction was half wrong, and the wrong half was the dangerous one.**
The issue proposes not re-throwing from the wrapper. `isArangoNotFound` guards
**18 call sites** that use it to tell *absent* from *failed*
(`if (!isArangoNotFound(err)) throw err; // never mask as "no row"`). Swallowing the
throw would convert every one of those into a silent "no row" — an outage rendered
as an empty result. **Severity drops to `debug`; the error is still re-thrown**, and a
test is named for that half.

**A second defect found while verifying it.** Measured against the real driver:
`collection.document()` miss → `errorNum 1202, code 404`; missing *collection* →
`errorNum 1203, code 404`. `isArangoNotFound` keyed on `code === 404`, so it returned
**true for a missing collection** — 18 call sites handed "document absent" for an
infrastructure fault. `errorNum` is now authoritative; 1203 correctly stays a fault.

**The measurement that was wrong.** My first cut treated only 1202 as absent. The
okf-server suite then failed **33 tests**: the fixtures in `concept-meta-service.test.js`
encode that `firstExample` throws `ArangoError 'no match'` with **errorNum 1204**, and
`firstExample` was **removed in arangojs 10**, so my live probe was structurally
incapable of seeing it. Both 1202 and 1204 mean "absent".

> **Standing rule:** one live measurement is not enough when the local driver version
> differs from the deployed one. Run the full suite, not just the targeted probe.

### 2.3 · Head suite: 20 ungrounded negative failures — !1071

The routing head answers queries it should reject. Correctness of the retrieval
surface; no data loss.

### 2.4 · `pii-service` missing from the local-build sync mapping — !1061

Sidecar changes are never rebuilt. Process defect that silently invalidates
local validation.

### 2.5 · `EMAIL_*` bare in backend, defaulted in Keycloak — !1074

Unset mail config becomes five empty strings in the service that actually sends
mail — fails at send time, not at config time.

### 2.6 · doc-repo scanning: dead local ClamAV + `CLAMAV_*`/`CLAMSCAN_*` mismatch — !1064

### 2.7 · PC-1 + PC-6 fixed but not deployed — !1062

Already-fixed defects awaiting rebuild + re-test. Administrative, but it blocks
the sign-off evidence for two.

---

## Wave 3 — throughput and capacity

**BOTH DONE in `10eced5ae` + `e1531706b`, pending live re-test.**

### 3.1 · Import throughput pinned at 4 concurrent PII scans — !1080

Measured: 24 cores, 442% used by the sidecar, okf-server at 0.52%. `12` is
already reachable with no code change (`importConcurrency()` clamps at `1..16`).
Needs the defaults raised **and** the pairing rule documented in
`operate/scaling.md`, `reference/env-vars.md`, `.claude/rules/ENVIRONMENT.md` and
`CLAUDE.md` — an agent reading only one of those must still get it right.

Defaults raised **1/2 → 4/4** in all declaration sites (compose, `env`, `env.j2`) —
the `2` dated from when the sidecar had 2 uvicorn workers. Documented on **every**
surface named above plus `configure/okf-variables.md` and `knowledge-base/ingestion.md`.

Every import now logs `OKF import lane capacity` with both values, whether they are
**paired**, and the core count — so a 4-lane/2-worker host is visible in the logs
instead of inferred from timings.

The two pairs are kept distinct throughout because they fail differently: **import**
lanes above the sidecar's workers *queue* (latency up, throughput flat); **drain**
lanes above dataprep's slots get **429** and retry.

> **Not done:** the issue's wall-clock acceptance (import Bali at 12/12 and compare
> against 4/4). That belongs to the live re-import cycle, not to a config commit.

### 3.2 · `OKF_INGEST_MAX_CONCEPTS` defaults to 200 — !1081

Raise to 1000; `OKF_INGEST_MAX_ZIP_BYTES` from 25 MiB to 256 MiB in the same pass
(Bali is 91.9 MB decompressed, Indonesia 109.4 MB). Document as use-case-dependent
capacity with the Bali worked example, because the cap is checked **after**
splitting and the operator cannot predict the outcome from the document count.

Both raised **in all four declaration sites** (service default, compose, `env`,
`env.j2`) — `crossReference conflicting=0` is the check that they agree, and it
would fail on a partial edit. The zip cap is documented as a **bomb guard and not
a capacity knob**, so nobody "tunes" it later.

Three existing tests pinned the `200` default; they were **updated, not deleted** —
they pin the resolver's fallback behaviour, and only the expected number changed.

---

**Waves 0–3 are now complete.** What remains is not a defect queue but the
**verification** half: everything above is proven by tests and falsifying checks,
and every one of them still needs the live re-import to close.

---

## Wave 4 — UX polish

!1066 (autocorrect reports a count, not what changed) and !1068 (step 10 Handoff
gives no pointer to the next surface). Cheap, and worth pairing with Wave 1.

---

## Needs a decision, not a fix

### !1065 — close or rewrite

Filed with a **wrong mechanism**. The correction (BUG-12) established that
`pii_hit_count` and `broken_link_count` are hardcoded literals in the AQL
(`conformance-service.js:173-181`), not a stale post-state counter as originally
claimed. It also killed `broken_link_count` as a casualty — it was equally dead
and never reported non-zero on any repo, including ones with broken links.

Whoever picks this up will otherwise implement the wrong fix. Either close it
superseded by a correctly-scoped rewrite, or amend it.

### BUG-16 — the Dismiss button on a link suggestion is dead

**New, 2026-10-15, found while fixing !1075.** Not yet in GitLab — creation was
blocked by the local permission classifier, so it is recorded in
`concept-doc-ceiling-defect-log.md` and still needs filing.

`Validate.vue` branches on `p.accepted` and nothing else, so the `p.dismissed = true`
that Dismiss writes cannot change what renders. A codebase grep for `dismissed`
returns that write and `Narrative.vue` only.

It needs a **decision before it needs a fix**: does a dismissed proposal disappear
from the list, or stay struck through with an Undo? Disappearing is destructive with
no way back. Either option needs new i18n keys across 14 deep-key-identical locale
files, which is why it did not go in with Story 10.8.

Suggested: keep it visible with an Undo, mirroring the "Done" pattern.

---

## Open question with no owner yet

### The 5 anomalous Bali split families

74 of 89 split families reconstruct **byte-exact** against the shipped splitter.
The other 5 have a stored part 2 that is **exactly one character longer** than
the splitter produces from either frontmatter-extraction variant, with every
other part matching. The body that reached the splitter had one newline inserted
mid-document that is not in the source bundle.

The `---` horizontal-rule hypothesis was **tested and is dead** — zero across all
999 files. Mechanism unknown. A 1-character content mutation in 5 of 89 split
documents (5.6%) is small but it means the stored corpus is not byte-faithful to
the source, which is worth understanding before it is 0.6% rather than 5.6%.

Needs instrumentation at the point the body is handed to the splitter — not a
guess. **Do not file as a defect until the mechanism is known.**

---

## Suggested execution order

**Gate before any large ingest (Tier 3/4, or a customer deployment).** Revised
2026-10-15 after !1079 was demoted and !1065 was fixed.

| # | Item | State |
|---|---|---|
| 1 | **!1065 / BUG-12** — `pii_hit_count` computed, `broken_link_count` removed | **DONE** `c080288` |
| 2 | **!1082** — suggester returns 22 entities against a ceiling of 20; accept 400s and every tag is lost | **DONE** `5fd5adb` |
| 3 | **!1070** — re-verify first; may be the !1079 footgun, not a separate defect | **CLOSED — not a bug.** `repo.graph_name` is `OKF_<uuid>` and no such collection exists, but the serving path deliberately derives names via `workingGraphName(repo)` (`retrieval-config-service.js:183`, documented in its module header). Design is correct; the field is a naming trap |
| 4 | **!1069** — frontmatter renders invisible; data intact but invisible, so curators re-type it | **DONE** `89d0c54` — 12 undefined tokens across 11 files, not the 2 filed |
| 5 | **!1077** → **!1075** → **!1067** — wizard cluster, ordered by how much each blocks | **ALL DONE** `59ebfb1f` · `49499fec` · `69983dbb2` — Wave 1 complete |
| 6 | **!1072** — 1202 logged at error on a clean drain; trains everyone to ignore errors | **DONE** `d79e3732` — severity only; the re-throw is load-bearing |
| 7 | **!1073** — 28 env vars never reach a container; make config trustworthy before Wave 3 | **DONE** `4758e71` — 26 wired, 2 are unimplemented and allowlisted; AC9+AC10 added |
| 8 | **!1080** + **!1081** together — throughput and capacity, config + documentation | **DONE** `10eced5a` + `e1531706` — Waves 0–3 complete |
| 9 | **!1060/!1063** — only with a reproduction in hand | parked |
| 10 | Wave 4 polish; !1061, !1064, !1074, !1062 | |
| — | !1079 — quoting helper + `arangodb-collections.md` note | low, any time |
| — | !1082 / !1065 / !1070 / !1069 / !1077 — **all closed with verdict**, still open on GitLab pending the live re-test | |

**Wave 0 is empty and that is the finding, not an oversight.** Every
silent-wrong item in the list turned out either to be loud already (!1079) or to
be fixed (!1065). The remaining queue is blocking or cosmetic, not
invisible.

One standing rule from this pass: **before ranking a finding as silent-wrong,
verify the client.** A raw-HTTP observation is not evidence about the
application, and I ranked one first off exactly that.

**Wave 0 first, always.** Every wave below it is cheaper to diagnose once a
silently-empty query raises an error instead of returning `[]`.
---

## BUG-17 — concurrent imports oversubscribe the PII sidecar, and the 504 invites a double-import

**New, 2026-10-15, found while raising concurrency during the Bali live re-test.**
Not yet in GitLab — creation was blocked by the local permission classifier, so
it is recorded here and needs filing. Three distinct defects, one root area:
**the import path has no concurrency control of any kind.**

### 17a — no guard against concurrent imports (the real one)

`POST /:repo_id/import` (`routes/repos-routes.js:69`) checks authz and repo
writability (409 when serving/drain-frozen) and then **proceeds**. There is no
"import already in progress" check, no per-repo lock, and no global semaphore —
the only concurrency construct in the path is `importConcurrency()`
(`services/ingest-service.js:378`), which builds a lane pool **per invocation**.

Consequence: the PII demand is `imports × OKF_IMPORT_CONCURRENCY` against a
fixed `PII_WEB_CONCURRENCY`.

| Concurrent imports | PII scans demanded | Workers | Effect |
|---:|---:|---:|---|
| 1 | 12 | 12 | paired |
| 2 | 24 | 12 | 12 queue |
| 3 | 36 | 12 | 24 queue |

**This falsifies the `paired` flag documented in `CAPACITY-SIZING.md`.**
`_logLaneCapacity` compares *one* import's lane count to the sidecar's worker
count and has no visibility of other in-flight imports, so a second import still
logs `paired=true` while the pair together oversubscribes 2:1. The pairing rule
is per-import; the contention is global. Compounding it, `PII_WEB_CONCURRENCY`
is normally **absent from okf-server's own env** (it belongs to the sidecar), so
in a real deployment `paired` is `null` — a "did you set both ends" signal, not
a contention gauge. The docs must stop implying it is the latter.

Also note the drain side is a different mechanism and is already capped:
`OKF_REPO_INGEST_CAP=3` (`workers/ingestWorker.js:307`) bounds per-repo
in-flight rows and is unrelated to import.

### 17b — the 60s gateway timeout invites a retry that is not safe

Measured live: the Bali import ran **12:33:58 → beyond 12:45** against Kong's
default `proxy_read_timeout` (unset in `kong.conf` → nginx 60s):

```
POST /api/okf/repos/e77ed721-.../import HTTP/1.1" 504 102
```

The browser gives up at 60s; **okf-server keeps working** — 555 concepts had
landed by 12:45 and the import was still running. The natural user reaction to
that 504 is to press import again, and nothing stops them.

The content-hash dedup at `ingest-service.js:606-613` does **not** save the
second import: it short-circuits only when `index_status === 'indexed'`, and
rows mid-import are `parsed`. So a retry re-upserts every concept (same
`concept_id`, so it overwrites rather than duplicates) while **doubling PII
load and interleaving writes with the in-flight import**.

### 17c — repo list is 1.34 MB, polled every few seconds

`GET /api/okf/repos?lifecycle=all` returns **1,339,846 bytes** and the admin UI
polls it continuously during an import. Kong logs `an upstream response is
buffered to a temporary file` on every poll — each response is written to disk.
This is pure overhead while the thing the user is waiting for is a 20-minute
blocking POST that already timed out.

### Suggested fix, in order

1. **Per-repo import lock** — 409 `IMPORT_IN_PROGRESS` while one is in flight.
   Cheapest, prevents the data-path damage, and makes 17b safe. Must be a
   durable marker (a repo field or a lease row), not in-process state, so it
   holds across a restart.
2. **Per-route `proxy_read_timeout` on the okf import route**, or return `202`
   with a job id and let the UI poll. Removes the retry temptation at the source.
3. **Make `paired` honest** — either compare against *observed* concurrent
   imports, or relabel it in the docs as a configuration check only.
4. **Trim the repo-list payload** while an import is running (counts only, no
   full bodies).

### Verification for whoever picks this up

- Two `POST /import` on one repo, second returns 409 (not a second pool).
- `docker exec okf-server` shows no more than `PII_WEB_CONCURRENCY` established
  connections to `pii:8000` at any instant, however many imports are running.
- A client that times out at 60s and retries does not double the PII load.

---

## BUG-18 — long-running operations give no progress feedback (spinner gap)

**New, 2026-10-15, found during the Bali live re-test.** Not yet in GitLab —
creation was blocked by the local permission classifier. Recorded here.

Two operations that take minutes on a 1,113-concept repo render **no spinner**,
only a disabled button:

| Operation | UI | Current feedback |
|---|---|---|
| Frontmatter **apply** (bulk) | `editor/AutocorrectPanel.vue` | `applying = true` disables the button; **nothing renders** |
| Duplicate / conformance scan | `steps/Validate.vue` | disabled button only |

**The feedback is inverted.** `AutocorrectPanel.vue:35-36` has the component's
only `DsSpinner`, gated on `v-if="scanning"` — so the fast dry-run *propose* gets
a spinner and the slow *write* does not. The apply re-parses every concept
(measured: 1,112 parses, several minutes), which is exactly when a spinner
matters most.

Per-field apply has the same gap: `applyingField` disables the row button
(`:72`) with no indicator.

**Why it is worse than cosmetic:** it makes the 504 (BUG-17b) actively harmful.
With no progress feedback, a user cannot distinguish "still working" from
"hung", so the only available action is to click again — and the 60s gateway
timeout means the browser has *already* given up. The UI invites the double-click
that the missing import lock cannot prevent.

**Fix.** Render `DsSpinner` (or a determinate progress bar if the endpoint can
report it) whenever `applying || applyingField || scanning`, not just `scanning`.
Reuse the existing `piiBulkBusy` pattern from `RepoEditor.vue:462-463` — the
state and the pattern are both already in the codebase.

---

## BUG-19 — near-duplicate detection is structurally prone to false positives

**New, 2026-10-15, reported live on Bali.** Not yet in GitLab — creation blocked
by the permission classifier. Recorded here.

The duplicate scan flags "quite a lot of false positives" on Bali (1,113
concepts). Two compounding defects in `services/validation-service.js`:

### 19a — similarity is computed on a 24 KB prefix, length-filtered on the full body

```js
// line 100-101
.filter((r) => (r.body_len || 0) >= DUP_MIN_BODY)
.map((r) => ({ id: norm(r.concept_id), len: r.body_len, sh: shingles(r.body_head) }))
```

`body_head` is `SUBSTRING(m.body, 0, 24000)` (`:256`) — the first 24 KB — while
`body_len` is `LENGTH(m.body)`, the **full** length. The 5% length window
therefore admits a pair using full-body lengths, but the Jaccard similarity only
ever sees the first 24 KB of each.

For documents **under** 24 KB the two agree and the comparison is sound. For
documents **over** 24 KB — which is nearly all of Bali, split at a 250,000-char
ceiling — any shared boilerplate in the opening (frontmatter, a standard lede, a
navigation template, a repeated disclaimer) drives Jaccard over the threshold
regardless of how different the remaining 90% is.

**So the detector is most reliable exactly where it is least needed (short,
distinct docs) and least reliable on the crawl-scale corpus it exists to
govern.**

### 19b — union-find makes one false pair collapse a whole corpus

Matching is transitive: a single spurious pair merges two groups permanently
(`parent.set(ra, rb)`). With 19a producing spurious pairs at scale, a handful of
them chains unrelated concepts into one reported group, and the UI shows
"N near-identical pages" for what is really a boilerplate artifact plus a
transitive chain. A curator cannot tell a real duplicate family from a merged
blob, and the remedy (keep-one-delete-the-rest) is **destructive**.

### 19c — the threshold was lowered to catch template sets

`DUP_SIM = 0.85`, lowered from 0.9 because "the NCD template sets sit at 0.896"
(`:90`). Calibrating down to catch near-identical *templates* is precisely what
maximises false positives on documents that legitimately share a template —
the two goals are in direct tension and 0.85 resolves it toward false positives.

**Suggested fix, in order.**

1. Compare on the **full body**, or at minimum compare the full body when both
   candidates exceed the prefix. The 24 KB cap needs a stated reason — if it is
   a performance guard, make it explicit (`DUP_BODY_SAMPLE`) and record the
   measured cost of removing it.
2. **Strip frontmatter and boilerplate before shingling.** Comparing raw body
   heads compares the parts most likely to be identical by construction.
3. Report **pairwise** similarity alongside each group so a curator can see why
   members were grouped, and make the destructive remedy opt-in per member.
4. Revisit `DUP_SIM` with 19a fixed — the two changes interact and re-tuning the
   threshold before fixing the input would bake in the wrong calibration.

**Do not act on Bali's current duplicate findings until 19a is fixed.** Acting
on them risks deleting distinct pages.

### Verification for whoever picks this up

- Import a repo with two long documents (>24 KB) sharing a 20 KB boilerplate
  opening and differing entirely after it. Today: flagged. After: not flagged.
- A genuine near-duplicate pair differing only after 24 KB must still be caught.
- No reported group may contain a pair below the threshold once union-find is
  applied — assert the grouping is a clique, not merely connected.

---

## BUG-20 — deleting one duplicate re-runs the whole-repo scan, and truncation is silent

**New, 2026-10-15, reported live on Bali.** Not yet in GitLab — creation blocked
by the permission classifier. Recorded here.

### 20a — every validation read re-scans the entire repo

`getValidationReport` (`services/validation-service.js:264`) has **no caching** —
zero cache/TTL/memo lines in the module. Every call does:

```js
const rows = await loadRows(repo_id);   // all 1,113 concepts, incl. body_head
const report = computeReport(rows);     // includes the O(n^2) near-dup scan
```

`GET /:repo_id/validation` (`routes/repos-routes.js:205`) is a plain GET, so any
UI refetch after a mutation pays the full scan. **Deleting one duplicate concept
therefore triggers a complete repo-wide re-scan** — the user-visible symptom.

This compounds BUG-19: the scan that re-runs is the one with the 24 KB-prefix
false positives, and the user cannot get a fast read of "is this repo clean"
without paying for it.

### 20b — **truncated results are presented as complete** (the serious half)

The near-dup scan has a runaway guard:

```js
if (comparisons >= DUP_MAX_COMPARISONS) {   // 20,000
  logger.warn('validation near-dup scan hit the comparison cap — results may be partial', { comparisons });
  break;
}
```

It `break`s and returns whatever it found so far. **Nothing in the returned
report records that it was partial** — no `partial: true`, no `truncated_at`, no
count of concepts actually compared. The `break` is also out of the inner loop
only, so the outer loop keeps comparing against the *next* candidate with a
counter already over the cap, which makes the behaviour harder to reason about
than a clean bail-out.

Consequence: a curator on a large repo sees **fewer duplicates than really
exist**, with no indication anything was skipped. The natural reading is "this
repo is clean" — the exact inverse of the truth, and the most dangerous possible
failure for a tool whose remedy is *delete the concepts*. It is a
silent-wrong-result defect, which by this worklist's own ordering rule outranks
the P1s.

**Worse in combination with BUG-18:** the warning goes to a log the UI never
shows, and the scan has no spinner, so a curator sees a fast response and has no
reason to suspect anything was skipped.

**Suggested fix, in order.**

1. **Surface truncation.** Return `partial: true` + `compared` / `candidates`
   counts from the report and render it in the UI. Until this lands, every
   duplicate result on a large repo is untrustworthy.
2. **Break out of both loops** on the cap so the behaviour is at least
   well-defined, and make the guard a hard stop rather than a per-inner-loop
   check.
3. **Cache the report** keyed on (repo_id, a cheap mutation counter or max
   `updated_at`), invalidated on concept add/remove/patch. Turns a
   delete-one-concept into a recompute-once, not a rescan-per-refetch.
4. Consider an **inverted index / MinHash prefilter** so the scan is
   sub-quadratic — 20,000 comparisons is a low ceiling for a 1,113-concept
   corpus, and BUG-19a (24 KB prefix) means the candidate set is inflated by
   shared boilerplate to begin with.

**Interim guidance for curators:** do not treat "no duplicates found" on a
large repo as meaningful until 20b is fixed. Check the okf-server log for
`hit the comparison cap` after the scan.

### Verification for whoever picks this up

- Delete one concept; the following `GET /validation` must not re-run the scan
  (assert via the `okf.validation.report` span's duration, or a cache-hit marker).
- Force the cap with a synthetic corpus; the response must carry
  `partial: true` and the UI must show it.
- A 1,113-concept crawl must complete the near-dup scan without truncation, or
  truncate *loudly*.

---

## BUG-21 — whole-corpus cross-linking is under-provisioned and unbounded in time

**New, 2026-10-15, reported live on Bali (1,113 concepts).** Not yet in GitLab —
creation blocked by the permission classifier. Recorded here.

`POST /:repo_id/topic-links` starts a whole-corpus run
(`topic-link-authoring-service.js:741`). Unlike the import (BUG-17) this one
**does** have an in-flight guard — a second run returns 409 `RUN_IN_FLIGHT`
(`:743-748`) — so the concurrency design here is sound. The problem is capacity
and predictability.

### 21a — every knob is unset, so every default is the historical one

Measured on the live stack:

| Variable | Live value | Falls back to |
|---|---|---|
| `OKF_TOPIC_LINK_LANES` | *(empty)* | **4** concurrent LLM calls (`:69`) |
| `OKF_TOPIC_LINK_BATCH` | *(empty)* | **8** concepts per call (`:68`) |
| `OKF_TOPIC_LINK_MAX_PER_CONCEPT` | *(empty)* | 6 (`:70`) |
| `OKF_TOPIC_LINK_TIMEOUT_MS` | *(empty)* | **60,000 ms** (`:75`) |

This is the same shape as the import problem fixed in !1080, on a different
service: documented, wired, and left at the single-flight value.

### 21b — the arithmetic, and the worst case

1,113 concepts ÷ 8 per batch = **139 LLM calls**. At 4 concurrent and the
**measured** per-call latency of 2,769 ms (granite-4.1-8b, 5,588 tokens), the
floor is **~96 s**.

The ceiling is what makes it unusable: at 4 lanes with a 60 s per-call timeout,
a run where calls time out takes **139 ÷ 4 × 60 s ≈ 35 minutes**, and nothing in
the response, the audit row, or the UI distinguishes that from the healthy
96-second case. There is no progress reporting on the run (compounding BUG-18),
so a curator cannot tell a 96-second run from a stalled one.

### 21c — raising lanes is NOT the same lever as the import

**The LLM is remote**: `VLLM_ENDPOINT=https://ai.assembly.govstack.global:444/llm`.
More lanes here means more concurrent load on a **shared external service**, not
more use of local cores. The sizing rule from `CAPACITY-SIZING.md` ("half your
cores") does **not** apply and would be wrong here.

Sizing must be against what that endpoint will absorb. Establish that by
measurement — a probe at increasing concurrency, recording p50/p95 and the
error rate — before setting `OKF_TOPIC_LINK_LANES`. If the endpoint is
single-tenant and idle, 8–12 is plausible; if shared, the current 4 may already
be at the limit and the fix is batching (`OKF_TOPIC_LINK_BATCH` ↑ reduces total
calls proportionally) rather than lanes.

**Raising the batch size is the cheaper lever here** — it cuts the number of
calls (and tokens) without adding concurrent load. Trade-off: bigger batches give
the model less per-concept context, so the fix is a measurement, not a guess.

### 21d — the pre-work is unmeasured

Before any LLM call, the run builds an inverted index over every concept —
`tokensFor` per doc, then a postings map and IDF weights
(`topic-link-authoring-service.js:186-212`). On 1,113 crawled documents this is
CPU-bound, single-threaded, and **not included in the 96 s figure above**. It has
never been timed. It may be a material share of the perceived wait, and it runs
on the okf-server event loop — blocking every other request while it runs
(the same event-loop ceiling noted in !1080).

### Suggested fix, in order

1. **Report progress on the run** — concepts done / total, batches done, LLM
   calls, failures, elapsed. The run already records `concepts_total` and
   `batches_total` in its status object; surface them. Without this the
   96 s-vs-35 min ambiguity is unresolvable from the UI (also BUG-18).
2. **Measure 21d and 21c separately** before tuning. Log the pre-work phase
   duration and the LLM phase duration as distinct spans; right now neither is
   attributable.
3. **Set the four knobs deliberately** for this deployment once 2 gives a
   number, and record why in the build's `.env` the way the import pair now is.
4. Consider **caching candidate pairs** between runs — the inverted index is
   rebuilt from scratch every time and only changes when the corpus does.

### Verification for whoever picks this up

- A 1,113-concept run reports progress throughout and a visible total elapsed.
- Time the pre-work phase and the LLM phase separately; assert the pre-work is
  not the dominant term (it currently cannot even be measured).
- Sweep `OKF_TOPIC_LINK_LANES` 4 → 8 → 12 against the live endpoint and record
  p50/p95 and the error rate at each, so the value is chosen from data.
- A run with a failing endpoint must fail visibly and quickly, not spend 35
  minutes in per-call timeouts.
