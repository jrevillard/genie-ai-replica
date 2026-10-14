# Publish/ingest cycle defects — separate work items (2026-10-13)

Defects found while running the wizard end-to-end on the local build with four
repositories (Solar System, Resilient AI Hub, El Salvador, NCD Information) and
retracting/re-ingesting Solar System. This is a **distinct cycle** from the
routing-lab defects tracked in `defects-1-8g-live-cycle.md`; the two logs share
a format but not a letter series. Here: `pc-N`.

**Cycle finding of record:** every one of these was found by running the product,
not by a test. The two that cost content (`pc-1`, `pc-2`) are both *silent* — they
drop uploaded knowledge from RAG without surfacing an error to the curator at the
point of loss.

## Status summary

| ID | Defect | Commits | CI | Local build |
|----|--------|---------|----|-------------|
| pc-1 | XML processing instruction crashes `unstructured` | `03e2bc260`, `2f90ae5de` | !542 #12751/#12758 | **not deployed** — image built, container not yet recreated |
| pc-2 | One `analyze()` on long text kills the PII worker → fail-closed publish | `f6ac10c8e`, `cc19bbe6a`, `9e434c981` | ✅ 12574/12577/12688 | deployed |
| pc-3 | PII bulk "Accept all" was dead code | `3b6c17b64` | no pipeline | deployed |
| pc-4 | Offset-translation test was vacuous | `53b731400` | no pipeline | n/a (test only) |
| pc-5 | Retraction log asserted caller intent it cannot know | `e96a3f90b` | no pipeline | deployed |
| pc-6 | Wizard step 5 / publish PII verdict overstated state | `c0169886d` | no pipeline | deployed (see the correction below — I first reported otherwise) |
| pc-7 | Ansible `.env` carried no PII vars at all | `c22262c89`, `14f2ddfad` | no pipeline | n/a (deploy config) |
| pc-8 | The pc-1 patcher would have failed the image build | `2f90ae5de` | !542 #12751/#12758 | n/a (build patch) |

**PC-1 is the only content-loss defect still undeployed.** Its image is built and
the patch is proven inside it (see PC-1 below); only the container recreate is
outstanding.

Five commits on `feat/okf-server` (`3b6c17b64`, `53b731400`, `e96a3f90b`,
`c0169886d`, `14f2ddfad`) have **no pipeline at all**. The last green on that
branch is `12688` at `9e434c981` (2026-10-13 09:39:14 UTC).

**Root cause of the gap is NOT "CI config skips feature branches"** — that was
the first hypothesis and it is wrong. `.gitlab-ci.yml` deliberately suppresses
the branch pipeline when an open MR exists (the standard de-dup rule) and
routes CI to a `merge_request_event` pipeline on `refs/merge-requests/<n>/head`
instead. That is why every pipeline ever seen for this branch carries
`ref=refs/merge-requests/278/head, source=merge_request_event` — they belong to
the permanent Draft MR **!278**, not to the branch.

**Consequence, and this is the architectural risk:** because the branch
pipeline is suppressed, **MR !278's pipeline is the ONLY CI `feat/okf-server`
ever gets.** MR !278 is `draft`, `cannot_be_merged`, and
`has_conflicts: true`. If GitLab ever declines to create an MR pipeline for a
conflicted or draft MR, the branch goes silently dark — which is exactly the
failure observed.

The pushes themselves succeeded: the server-side branch head **is**
`14f2ddfada9c8748df90cfe70f81eaebed850712`. Only the pipeline-creation step is
missing. Control cases prove the mechanism works before and after the window —
`main` push 18:36:43 UTC produced #12720, and MR !542 produced #12751 on
2026-10-14.

Support ticket drafted: `.scratch-pii/gitlab-support-ticket.md` (untracked).
Four questions for UNICC: instance logs for the window, instance-wide pipeline
activity, whether a conflicted/draft MR suppresses MR pipeline creation, and
whether the missed pipelines can be backfilled.

**Interim CI gate for this batch:** MR !542 is a strict superset of
`feat/okf-server`'s tip (`14f2ddfad` + 3 commits), and its
`merge_request_event` pipeline builds the **merge result** — so #12751
transitively tests all five unpipelined commits.

---

## pc-1 — XML processing instructions silently cost whole concepts from RAG (FIXED, NOT DEPLOYED)

David's report, verbatim, from the wizard after ingesting Solar System:

```
Serving, but 2 concepts failed to ingest.

pds4-dph-1-26-0-sec99 — Ingestion Error: 'lxml.etree._ProcessingInstruction' object has no attribute 'is_phrasing'
pds4-dph-1-26-0-sec100 — Ingestion Error: 'lxml.etree._ProcessingInstruction' object has no attribute 'is_phrasing'
```

**ROOT CAUSE.** `unstructured/partition/html/parser.py:929` builds the package's
only `etree.HTMLParser(remove_comments=True)`. Immediately after, at line 933, an
`ElementNamespaceClassLookup(fallback)` registers GENIE's `Flow`/`Phrasing`
classes for `_Element` **subclasses only**. An XML processing-instruction node is
an `_Element` that is not an `ElementBase`, so it falls through to lxml's bare
class, which has no `is_phrasing`. Three traversal sites share that assumption:
lines 423, 628 and 750.

**WHY IT IS REACHABLE FROM ORDINARY CONTENT.** `partition_md` renders markdown to
an HTML **string** (`md.py:76`) and hands it to `partition_html` (`md.py:78`).
Python-Markdown passes a literal `<?xml ... ?>` line through unescaped, so any
source document that *teaches XML declarations* crashes the documenter.
`PDS4_DPH_1.26.0.pdf` does exactly that across 13 of its 155 pages.

**MEASURED, NOT ASSUMED.** Two dead ends were falsified before accepting a fix:

- *Version incompatibility* — lxml 4.9.4 and 5.4.0 emit the identical PI node and
  fail identically, run side by side. Version arithmetic cannot fix this.
- *Boundary sanitisation* — deleting `<?` / `<!--` at OUR boundary strips
  legitimate content: inside a fenced code block a comment is literal TEXT, not an
  HTML node. Measured 195 → 164 chars on a real sample.
- *Node guards* — guarding line 423 alone leaves 5 of 13 PI-bearing documents
  still crashing at lines 628/750; a break-style guard merely relocates the
  failure to the `assert not q[0].is_phrasing` at line 360.
- *Switching to docling* — drops content outright (772 chars vs ~153,071).

**THE FIX.** Upstream's own repair: `unstructured` added `remove_pis=True` to that
same constructor in **0.27.8** (absent 0.18.32–0.27.6), with a commit note naming
this exact AttributeError as upstream issue **#4358**. We are pinned to 0.18.32 and
the upgrade spans 9 minor releases across a 374-package `--require-hashes --no-deps`
lock, so `genie-ai-overlay/build-patches/unstructured_html_pi_patch.py` applies the
single constructor argument instead.

Patching the **construction site** rather than any traversal site makes the module
correct by construction: `partition.py:17` binds the name by import and both
`etree.fromstring` call sites inherit it, so there is no next unguarded attribute
for a crash to relocate into.

**THREE OUTCOMES, NEVER A SILENT NO-OP** — the property that matters most in a
patcher. `unpatched` → patch, re-read, verify the on-disk post-state.
Already carries `remove_pis` → idempotent no-op, exit 0 (graceful once the pin
crosses 0.27.8). Neither → `SystemExit`, so the **image build fails loudly**
rather than shipping an image with the crash still present. A patcher that
silently no-ops is worse than no patcher.

**VERIFICATION.** 13/13 PI cases pass, and **0 changed outputs across a
138-document corpus of previously-parsing input** — the patch removes the crash
without altering anything that already worked. 11 tests (10 pass, 1 skipped
without lxml/unstructured; it runs inside the image where they are present).

**IMAGE BUILT AND PROVEN; CONTAINER NOT YET RECREATED.** Verified in the built
image `534cb9afabc7`, not inferred from the build's exit code:

```
line 929:  html_parser = etree.HTMLParser(remove_comments=True, remove_pis=True)
remove_pis count: 1
```

Behaviourally, in the image itself — and falsified against the previous one, so
the patch is demonstrably *what* fixed it:

| Image | `partition_md` on PI-bearing markdown |
|---|---|
| new `534cb9afabc7` | 3 elements, 45 chars — partitions cleanly |
| old `fe8c46c2` | `AttributeError: 'lxml.etree._ProcessingInstruction' object has no attribute 'is_phrasing'` |

The old image reproduces David's reported error **verbatim**.

The running container still uses the old image, so `pds4-dph-1-26-0-sec99` /
`sec100` keep failing until it is recreated.

**RE-TEST.** Rebuild dataprep → re-ingest `pds4-dph-1-26-0-sec99` and
`pds4-dph-1-26-0-sec100` → both reach `status=ingested`. **Negative control:** a
content-free concept must still fail with *"No valid content extracted"*, proving
the patch did not simply make every document succeed.

## pc-2 — One `analyze()` on a long text killed the PII worker and blocked publish (FIXED, DEPLOYED)

An 805 KB concept never published. The PII sidecar is uvicorn-multiprocess: the
parent pings each child and **SIGKILLs** it on a missed 5 s pong. A single
`analyze()` call over a long document holds the GIL inside native spaCy/thinc code,
so the child cannot answer the ping and is killed mid-scan → `ECONNRESET` → the
fail-closed publish gate records a permanent `error` state. Recovering required
retract → create version → ingest, repeatedly; it landed on attempt 5 via the
reaper.

**FIX, three commits.**

- `f6ac10c8e` — serialize `analyze()` so only one worker is ever in native code.
- `cc19bbe6a` — a respawn no longer writes a **permanent** PII `error`; a killed
  worker is a retryable condition, not a verdict.
- `9e434c981` — the real bound: `split_regions` cuts long text into
  `REGION_MAX_CHARS` (default 50,000) regions so no single `analyze()` can exceed
  the supervisor's window. The knob is `PII_REGION_MAX_CHARS`, sized from
  measurement and documented in `env` §15 with a lower-it-on-a-slower-host note.

**MEASURED:** an 850 KB page killed the worker **8/8** before the knob existed and
**0/10** after; it split into 18 regions. A live 12-region scan produced 4,791
hits, 8,273 distinct offsets, 0 deaths.

**RESIDUAL, NOT CLOSED.** 2 post-scan worker deaths remain, both *after* scan
completion; one 12-region/4,791-hit scan ran twice with identical results.
Serialization pressure in the post-scan window is a **hypothesis, not a
conclusion** — it needs instrumentation of that window before any further fix.

## pc-3 — Bulk "Accept all" was dead code (FIXED, DEPLOYED)

`pii-service.js` filtered prior resolutions with
`.filter((r) => r && r.action === 'accept')`, but the action written by the bulk
path is the `ACCEPT_ALL_FINDINGS` constant. The filter therefore matched nothing,
so a whole-concept "Accept all" never suppressed the findings it had just
resolved. `isSuppressingAccept()` now takes the set
`{accept, ACCEPT_ALL_FINDINGS}`; both call sites use it.

`'accept_repo'` is **deliberately excluded** — 321 legacy records carry it and
must stay inert.

**Test:** a suite that drives `inspectConcept` through the REAL call path with
persisted findings + ledger, not just the unit. Falsified by reverting the filter:
2 findings returned instead of 0.

## pc-4 — The offset-translation test was vacuous (FIXED)

`test_offsets_are_absolute_across_regions` asserted only
`0 <= start <= end <= len(text)` and `end - start == 5` — both satisfied by the
region-LOCAL pair `(0, 5)`. It would have passed with the pc-2 fix reverted, which
is precisely the test that mattered.

Now asserts: distinct starts, ascending order, equality with `split_regions`
offsets, and that the spans actually slice the original text.

**The general lesson, recorded in memory as `feedback-verify-instrument-before-trusting`:**
when a number is surprising, the first hypothesis is "my query is wrong", not "the
system is broken". That ordering was right three times this cycle and wrong once.

## pc-5 — The retraction log asserted caller intent it cannot know (FIXED, DEPLOYED)

The dataprep retraction log emitted `"Starting retraction analysis..."` FIRST and
unconditionally, then the outcome. `retract_file` has three callers — the
defensive pre-POST sweep in okf-server's ingestWorker (the overwhelmingly common
case, where it finds 0 and removes nothing) and the CancelledError /
generic-Exception rollbacks inside dataprep itself. The old wording asserted
"This is the normal pre-ingest cleanup check" and "no retraction is in progress" —
**false on both rollback paths**, where the call IS the retraction and the failure
is exactly what a curator reads the log to find.

A curator scanning the bundle's Ingestion Log tab read the intent line, concluded
his data was being deleted, and stopped reading.

**FIX:** outcome first, intent second; state only what the function can observe.
Behaviour is unchanged — the orphan-cleanup find still always runs and the chunk
count is still logged either way, so cleanup stays auditable.

## pc-6 — Wizard step 5 and the publish PII verdict overstated state (FIXED, NOT DEPLOYED)

David: *"step 5 seems redundant… you cannot do anything about the labels
displayed… Let's evaluate step 5 and tune it to be useful."* And, of the publish
gate: *"this will obviously NOT work properly with a full end to end test."*

The publish path reported a PII verdict without re-checking the whole repo, and
the wizard's step-5 copy described a state the user could not act on and, in
several cases, that was not true. `c0169886d` adds the publish-time verdict plus a
repo re-scan, `PiiReviewSummary` / `PiiRepoRescan` / `piiReview.js`, a real
PII review verdict surfaced in review, and rewrites the step-4/step-5 narrative in
**all 14 locales**. It also deletes three dead i18n keys (`add`, `addConfirm`,
`placeholder`) that no component read.

**DEPLOYED — and I first reported the opposite.** An earlier revision of this
register claimed PC-6 was not deployed, on the evidence that "0 of its 6 new
exported identifiers appear in the served bundle". That check was wrong. It
grepped the minified bundle for **exported `const` names** (`PII_CHECKING`,
`PII_UNREADABLE`, …), which Terser renames and inlines — they will never appear
in a production bundle regardless of whether the code shipped.

Grepping instead for **i18n key strings**, which survive minification because
they are literals, shows `piiRescan`, `piiReview`, `unreadableTitle`,
`progressIdle` and `stillBlocking` all present in the served bundle. And the
running frontend image was built at **2026-10-13 14:28 UTC**, 2 h 45 m *after*
`c0169886d` landed (11:43 UTC). PC-6 shipped with the build that followed it.

This is the same grep-the-wrong-thing mistake as the sidecar `died` substring
false positive, caught the same way: by asking what the instrument actually
measures before trusting what it reports.

## pc-7 — The cloud `.env` carried no PII vars at all (FIXED)

Every PII tuning knob existed in `docker-compose.yaml` and in `env`, but **not in
`deploy/ansible/templates/env.j2`** — so an Ansible (cloud) deploy silently
dropped the entire PII configuration. This is the exact class of defect the
config-validator parity tests exist to catch, and they did not cover it.

`c22262c89` + `14f2ddfad` add the vars to `env.j2` and pin the parity in
`config-validation.test.js` (51/51 green).

## pc-8 — The pc-1 patcher would have failed the image build (FIXED)

Found by dry-running the patcher against the **real** `parser.py` copied out of the
running image, not against my own fixture. Three host/fixture-dependent defects,
none of which CI on Linux would have caught:

1. The real constructor sits at **column 0**. A fixture (or a literal) carrying 4
   spaces of assumed indent never matches, the guard fires, and the image build
   fails. The patcher now matches on content while capturing and reapplying the
   file's own indentation.
2. `read_text`/`write_text` use `newline=None`, which translates LF to
   `os.linesep` on write — a dry run on Windows turned all **1018 lines** of the
   real `parser.py` to CRLF, making a one-line patch look like a whole-file
   rewrite. Now `open(..., newline="")` on both read and write.
3. The test fixture itself was CRLF on this host, which made 6 tests fail while
   the suite summary claimed otherwise.

**The general lesson is the same as pc-4:** exercise a patch against the REAL
artefact. A patcher tested only against a fixture I wrote is untested.

---

## Evidence anchors

- Live corpus, 2026-10-13: Solar System `9e65a7cb`, Resilient AI Hub `73b0351c`,
  El Salvador `1e8258ad`, NCD Information `f043215b`.
- PII sidecar log signature (the real one): `INFO: Child process [N] died`. A bare
  `grep -c "died"` matches substrings and produced a false worker-death report.
- Label coverage measured with the production predicate (`LABELLED_COUNT_AQL`),
  2026-10-14: NCD 45/45, gov-uk 985/996, Indonesia-Hybrid 852/997, Solar System
  105/139 (75.5%), El Salvador 349/585, **Bali-wikipedia-LLM 115/998 (11.5%)**.

## Curated-corpus finding (not a defect — an operational note)

Bali-wikipedia-LLM is the **only** repository of fourteen whose curation pass
recorded LLM failures: 793 of 998 concepts carry
`curation.resolved_by: "llm-error"` from a vLLM outage on 2026-09-12. Its progress
bar nevertheless read `982/1002` and `final: true`, because that pass predates
`dcad12234` (2026-10-12, "the curation bar divided two different numbers"). The
current code reconciles the terminal count against the database and gates the
increment on a label actually persisting; Solar System, curated after the fix,
reads honestly at 105/139. **Bali needs a re-curation pass** if it stays in the
routing lab.

## Test totals measured for this cycle (2026-10-14)

| Suite | Result |
|-------|--------|
| `components/okf-server` (jest) | 1137/1138 — the 1 failure is the documented `import-links-integration` full-suite load flake, **green isolated** (2/2) |
| `components/gov-chat-frontend` (jest) | 1870/1870, 95 suites |
| `genie-ai-overlay` dataprep + patch (pytest) | 139 passed, 1 skipped (lxml/unstructured behavioural test skips outside the image) |
| `tests/config-validator` (jest) | 51/51 |
| `verify-local-build.sh` | 63 pass, 0 fail |
| ruff check / format (patcher + test) | clean / clean |