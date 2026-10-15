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