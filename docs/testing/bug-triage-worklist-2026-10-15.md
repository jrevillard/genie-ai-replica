# Bug triage — prioritized fix queue

**Triage date:** 2026-10-15 · **Source:** issues !1060–!1081 raised during the
concept-document-ceiling test plan · **Status:** open work list, to be worked
after the Bali (Tier 3) drain is under way

The ordering is by **blast radius × whether the failure is silent**, not by the
P-labels on the issues. A P3 that silently returns wrong data outranks a P1 that
fails loudly.

---

## Wave 0 — do first: silent-wrong results

These do not announce themselves. A user gets a confident wrong answer and no
error anywhere. Everything in Wave 1 is loud by comparison.

### 0.1 · Fail loud on ArangoDB cursor errors — !1079

**The single highest-leverage fix in the queue.** AQL cannot reference a
hyphenated collection name unquoted — the hyphen parses as subtraction:

```aql
FOR d IN OKF_solar-system_v1_SOURCE RETURN d._key
-- {"error":true,"errorNum":1203,"errorMessage":"collection or view not found: OKF_solar"}
```

Every OKF graph name derives from a bundle slug, so **every one contains a
hyphen**. The response carries no `result` field, so `(await db.query(aql)).result || []`
returns `[]` and a caller concludes the collection is empty.

Why first: this exact shape cost three wrong conclusions in one session,
including a near-miss filed as *"144 concepts indexed, repo reports Serving, graph
is empty — silent false-success"*. The graph held 3,011 chunks. **Fixing this one
turns every future instance of the whole class from silent-wrong into a loud
error**, and it is a small change to the shared DB layer — not a per-query patch.

Two parts: reject on `error`/`errorNum` in the shared driver, and a quoting
helper so the correct AQL form is the easy one.

### 0.2 · Graph collections named after the bundle, not `repo.graph_name` — !1070

Same family, same class of surprise: the collections the repo *names* read empty
after a successful ingest, because the graph is written under a bundle-derived
name (`OKF_solar-system_v1`) while `repo.graph_name` says something else
(`OKF_<uuid>`). An operator or agent checking `repo.graph_name` sees nothing and
concludes the ingest failed.

Fixing 0.1 first makes this fail loudly instead of silently, which is what makes
it diagnosable.

---

## Wave 1 — data entry blocked

Loud failures that stop a curator doing their job. Ordered by how much they block.

### 1.1 · Frontmatter panel renders invisible in dark mode — !1069

Saved tags and fields load correctly and render as nothing — styles reference a
`--color-*` token vocabulary that does not exist, so the values resolve to
initial values. **The data is intact; it is only invisible**, which makes it
especially dangerous: an operator re-types values that were already saved.
Highest-severity item where nothing errors.

### 1.2 · `type: index` is written, accepted, then flagged INVALID_TYPE — !1077

The product writes `type: 'index'` on the bundle root (`crawl-conversion-service.js:709`),
accepts it as valid in `is_index` (`concept-meta-service.js:157`), then flags it
`INVALID_TYPE` against a 5-value enum that has no `index`. There is **no guided
remedy**, so a curator hits a wall. Two vocabularies maintained independently is
the root cause; the same shape produced BUG-12's enum drift.

### 1.3 · Accepting one link suggestion unmounts all the others — !1075

Suggestions render *inside* the orphan issue row they remediate; accepting one
cures the orphan, the row unmounts, and every remaining proposal is destroyed.
Story 10.8 (!1076) is the remediation and is already written.

### 1.4 · PII sidecar worker dies — !1060, !1063

Two linked issues, root cause still unknown (!1060), with a residual worker
death after scan completion (!1063). This one has consumed more time per unit of
progress than anything else in the queue. **Do not start it without a
reproduction** — it has resisted three attempts.

### 1.5 · Bundle-imported repo opens on wizard step 9 — !1067

Opens past the only step with a blocking requirement, with no cue that Curate
(where PII, frontmatter and cross-links are resolved) exists. Cheap to fix once
1.1–1.3 are in, because all three are step-9/10 surfaces.

---

## Wave 2 — operational and diagnostic

### 2.1 · 28 env vars documented but never reach a container — !1073

Setting them in `.env` is silently ignored. Everything in Wave 0 and Wave 1 that
is configurable depends on this being trustworthy. **Fix before any config knob
in Wave 3 is treated as working.**

### 2.2 · ArangoDB 1202 logged at error and re-thrown by the retry wrapper — !1072

24 error lines per 2 minutes on a *clean* drain. This is what trains operators
(and agents) to ignore error logs. Same fix shape as 0.1.

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

### 3.1 · Import throughput pinned at 4 concurrent PII scans — !1080

Measured: 24 cores, 442% used by the sidecar, okf-server at 0.52%. `12` is
already reachable with no code change (`importConcurrency()` clamps at `1..16`).
Needs the defaults raised **and** the pairing rule documented in
`operate/scaling.md`, `reference/env-vars.md`, `.claude/rules/ENVIRONMENT.md` and
`CLAUDE.md` — an agent reading only one of those must still get it right.

### 3.2 · `OKF_INGEST_MAX_CONCEPTS` defaults to 200 — !1081

Raise to 1000; `OKF_INGEST_MAX_ZIP_BYTES` from 25 MiB to 256 MiB in the same pass
(Bali is 91.9 MB decompressed, Indonesia 109.4 MB). Document as use-case-dependent
capacity with the Bali worked example, because the cap is checked **after**
splitting and the operator cannot predict the outcome from the document count.

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

1. **!1079** — fail loud on cursor errors (unblocks honest diagnosis of 0.2, 2.2)
2. **!1070** — graph naming, now diagnosable
3. **!1069** — invisible frontmatter (data is intact, operators are re-typing it)
4. **!1077** → **!1075** → **!1067** — the wizard cluster, ordered by how much each blocks
5. **!1073** — make config trustworthy before touching Wave 3
6. **!1080** + **!1081** together — throughput and capacity, both are configuration + documentation
7. **!1060/!1063** — only with a reproduction in hand
8. Wave 4 polish; decide !1065

**Wave 0 first, always.** Every wave below it is cheaper to diagnose once a
silently-empty query raises an error instead of returning `[]`.