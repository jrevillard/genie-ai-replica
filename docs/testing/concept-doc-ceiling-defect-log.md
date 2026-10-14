# Defect Log — Concept Document Ceiling live run

Companion to [concept-doc-ceiling-test-plan.md](concept-doc-ceiling-test-plan.md).
Raised during the operator run on the local build, 2026-10-14.

Status key: **OPEN** / **FIXED** / **FALSE POSITIVE** (my measurement error, not a
product defect) / **WONTFIX**

---

## BUG-01 — PII bulk-accept leaves no visible record of what was accepted

**Status: OPEN** · Severity: high (governance) · Found 15:29:35 on tier 0 · **!1065**

`repo.pii_bulk_accept` — *"PII BULK ACCEPT on repository — **17 flagged
concept(s)** processed (**scan-free**; publish gate satisfiable)"*.

The operation satisfies the publish gate **without running a scan**, and after it
completes every subsequent `Repo metrics computed` line reports
`pii_hit_count: 0`.

**The consequence:** the only durable evidence that 17 concepts were flagged is
one audit row. The metrics surface — the thing a curator actually reads — reports
zero PII both before and after, because `pii_hit_count` is a *post*-state counter.
A curator can bulk-accept 17 flagged concepts and see a dashboard that says the
repo is PII-clean, with no count of what was waved through anywhere in the UI.

**Why this matters:** the publish gate is what this exists to satisfy. "Scan-free"
means the gate records an acceptance, not a verification.

**Suggested direction:** keep the audit row, but surface the accepted count where
the curator already looks — e.g. a persistent chip on the repo card reading
"PII accepted: 17 concepts", and keep `pii_hit_count` reporting the *pre-accept*
flag count rather than resetting to zero.

---

## BUG-02 — Auto-correct's summary does not say what it changed or where

**Status: OPEN** · Severity: medium · Found 15:30:44 on tier 0 · **!1066**

`repo.autocorrect` — *"Applied frontmatter autocorrect — **17 change(s)** across
the repository"*.

The count is right but it is unattributed. On this run the 17 were the same 17
concepts from the PII bulk accept, and **not** the frontmatter tags — but nothing
in the message says so. The operator read it as "my tags just changed" and
re-ran the LLM tag suggestion in the editor as a precaution.

That precaution cost a redundant ~45 s vLLM call (15:37:18 → 15:37:22) and
re-saved the head twice more (15:38:06, 15:39:25). Harmless in outcome — the
`frontmatter_history` proves all four saves are byte-identical — but it is exactly
the kind of ambiguity that makes a curator distrust the state they are looking at.

**Suggested direction:** name the scope in the message — e.g. *"17 change(s) across
17 concept(s); frontmatter tags unchanged"* — and make the autocorrect panel show
a per-concept diff the curator can expand, not just a count.

---

## BUG-03 — A bundle-imported repo opens on step 9 (Review), past the only step with mandatory work

**Status: OPEN** · Severity: high (first-run experience) · Found 15:28–15:30 on tier 0 · **!1067**

The bundle-import path creates the repo with only `{name, domain}`
(`StudioTab.vue:467`) and never seeds `studio_step`, so the wizard's landing step
is whatever the default leaves — empirically **step 9 "Review"**, which is past
Curate, the only step with a blocking requirement.

- Step 9 `Review.vue` carries **no frontmatter cue** — a concept count and one
  passing mention of labels.
- The only signal is `steps/Publish.vue:97-104`, which is **step 10, the last
  step**: *"Frontmatter tags not approved — the LLM can draft them in Curate."*

So the user clicks through nine steps and hits a dead end telling them to navigate
backwards. This was the first thing that went wrong on the run, before any data
was touched.

**Fix:** seed `studio_step: 5` (Curate) on bundle import, exactly as the crawler
path already does at `StudioTab.vue:674` and `:686`.

---

## BUG-04 — Instrument error (FALSE POSITIVE — not a product defect)

**Status: FALSE POSITIVE** · My measurement, recorded so it is not repeated.

Two measurement errors produced wrong readings during this run. Both were caught
by re-measuring with a different instrument:

1. **`pii_hit_count: 0` read as "no PII".** It is a post-acceptance counter. The
   real figure was **17 flagged concepts**, from the audit trail. I reported "there
   was nothing to resolve" on the strength of a single metrics line and was
   wrong.
2. **`okf_audit` returned 0 rows**, which looked like the audit trail was not
   persisting. The collection was renamed `okf_audit` → `okf_audit_logs` on
   2026-08-31 (`services/audit-service.js:11`). The trail is intact — **28 rows**
   for this repo.

Also carried forward from the plan's §5.2: `COLLECT AGGREGATE c = LENGTH(d)`
returns `undefined` on object values in this AQL build. All counts in this work
are taken from a plain `FOR … RETURN` and tallied in JS.

---

## BUG-06 — Frontmatter panel styles against a token vocabulary that does not exist

**Status: OPEN** · Severity: high (visual correctness, theme-wide) · Found ~15:45 on tier 0 · **!1069**

**Symptom:** in dark mode, opening the frontmatter editor in the studio editor
sometimes shows light-mode objects.

**Root cause — verified, not inferred.** `src/theme-variables.css` defines **127**
tokens in the vocabulary `--surface` / `--fg` / `--muted` / `--border` / `--accent`,
with a dark block plus a `@media (prefers-color-scheme: dark)` block. **Zero
`--color-*` tokens are defined anywhere in the application.**

Two files nevertheless style themselves against that non-existent vocabulary:

| File | Distinct `--color-*` tokens | Uses |
|---|---|---|
| `src/components/okf/FrontmatterPanel.vue` | 10 | 19 |
| `src/components/okf/editor/ConceptEditor.vue` | — | — |

In `FrontmatterPanel.vue`: `--color-surface-base` ×3, `--color-surface-raised` ×1,
`--color-text` ×1, `--color-text-muted` ×2, `--color-text-faint` ×4,
`--color-border` ×2, `--color-border-subtle` ×2, plus `--color-danger`,
`--color-success`, `--color-text-secondary` (each with a `currentColor` fallback).

**Mechanism.** A `var()` with no fallback and no matching custom property is
invalid at computed-value time: `background: var(--color-surface-base)` resolves to
the **initial value** (transparent), so chips render with no surface of their own
and show whatever is behind them. `color: var(--color-text)` and its siblings
resolve to **inherited** colour. Neither responds to the theme, so a light-surface
ancestor paints them light in dark mode.

**Why it is intermittent, not total.** The accent-tinted elements survive because
`--accent` and `--accent-muted` *do* exist — the fallbacks on
`border-color: var(--accent, var(--color-border))` and
`background: var(--accent-muted, var(--color-surface-base))` are never reached. So
the suggested-forbidden chips render correctly while the plain surface and text
elements do not. That is exactly the "sometimes light, sometimes not" report.

**Not affected:** `HeadTestDialog.vue` (the Routing Lab) uses the real vocabulary —
23 token references, zero `--color-*`.

**Fix:** rewrite both files onto the shipped vocabulary —
`--color-surface-base` → `--surface`, `--color-surface-raised` → a raised surface
token (or `--surface` plus a border), `--color-text` → `--fg`,
`--color-text-muted` / `--color-text-faint` → `--muted` / `--muted-soft`,
`--color-border` / `--color-border-subtle` → `--border` / `--border-light`,
`--color-danger` / `--color-success` → the corresponding status tokens.
**Add a lint rule that fails on any `var(--color-*)`** so a third file cannot
repeat it — the whole class of bug is that an undefined custom property fails
silently rather than visibly at build time.

---

## BUG-08 — Graph collections are named after the bundle, not `repo.graph_name`

**Status: OPEN** · Severity: medium (debugging trap) · Found on tier 0 · **!1070**

**Symptom.** After a successful ingest, querying the repo's own graph collections
returns **0 documents**, while the repo doc reads `ingested_version: 1` and
`ingested_at` is set. The data is there — under a different name.

**Evidence (two independent reads).** Repo doc reserves
`graph_name = OKF_<repo_id>` — for this repo `OKF_42b2f2df-880c-4ed5-9208-7b36f05a8029`,
whose four collections are all **empty**. The drain instead wrote
`OKF_alphabet-company-information_v1_*`:

| Collection | Docs |
|---|---|
| `OKF_alphabet-company-information_v1_SOURCE` | **114** — exactly the chunk count the worker reported |
| `…_ENTITY` | 756 |
| `…_LINKS_TO` | 999 |
| `…_HAS_SOURCE` | 970 |

**Why it matters.** Anyone debugging an ingest by reading `repo.graph_name` and
querying those collections concludes ingestion silently produced nothing — which
is exactly the false conclusion this defect invites, and precisely the failure
mode already seen in the ingestion-crash investigation (concepts that "silently
never reach RAG").

**Direction to confirm before fixing:** decide which is canonical — the reserved
`OKF_<repo_id>` or the derived `OKF_<bundle-name>_v<n>` — then make the other
derive from it. Whichever wins, `repo.graph_name` must equal the name actually
written, because it is the field any operator or agent will read first.

---

## BUG-09 — Head suite: 20 ungrounded negative failures

**Status: OPEN** · Severity: medium (retrieval quality) · Found on tier 0 · **!1071**

`head-suite.run` on tier 0: **pass_rate 0.856** over **139 queries**, `steals: 0`.
`head-suite.recommend.done`: score **`219 → 219`** (no gain), `narrow_options: 0`,
`add: []`, `remove: []`, and **`ungrounded_negative_fails: 20`**.

**What that means.** Twenty negative queries — ones that should *not* route to
this repository — were answered by it. That is the observable the vectorized head
exists to improve, so it matters more than the headline pass rate: a head that
answers questions it has no business answering degrades every query in the
deployment, not just this repo's.

The recommendation engine found nothing to change, which means the current tags
are a local optimum for this suite — worth confirming against tiers 1–4 before
concluding the tags themselves are the problem rather than the suite composition.

**Suggested direction:** establish the ungrounded-negative rate per repo across
the live set (UK crawl, El Salvador, Slaugherhouse all have heads today) before
acting. If 20 is normal for an 18-concept repo, the metric needs normalising by
suite size; if it is an outlier, the head is mis-scoped.

---

## RESOLVED-01 — Scratch `pi/parser.py`: is the PC-1 patch managed, and does docling need one?

**Status: RESOLVED — no action** · Raised as a challenge to the scratch-file cleanup

David challenged the claim that `.scratch-pii/pi/parser.py` was disposable,
because `pi` reads as Presidio and there are live PII issues (!1060, !1061,
!1063). Five readers fanned out over the managed patch, dataprep's parsing paths,
the scratch prototype, and the live image; every claim was then adversarially
re-verified against source.

**My original claim was wrong twice.** I stated the file was docling's
`_partition_html/parser.py` and that `remove_pis` appeared nowhere outside the
scratch directory. Both false:

1. `pi/parser.py` carries **12** occurrences of `is_phrasing` / `class Flow` /
   `class Phrasing` — unstructured's vocabulary, not docling's. It is
   **`unstructured/partition/html/parser.py`**, the exact file the managed patch
   targets.
2. `remove_pis=True` **is** in the live image at line 929. I had grepped docling
   because I had mis-identified the file first, then built the second conclusion
   on the first error.

**Is the fix managed? Yes.** `genie-ai-overlay/build-patches/unstructured_html_pi_patch.py`,
registered in `OVERRIDES.yaml:138-144` as `still-needed` with regression test
`tests/test_unstructured_pi_patch.py`, applied at build time by
`Dockerfile-dataprep_genie-ai:142-143` after the site-packages `COPY` at
`:117-118` — so the edit lands on the tree the later smoke test at `:153` reads.
It rewrites one line (`UNPATCHED_RE`/`PATCHED_RE` at `:84-91`, substitution at
`:151-158`) with a `compile()` check and a re-read verification, and is idempotent.
Upstream fixed this in **unstructured 0.27.8** (issue #4358); we pin **0.18.32**.

**Is it actually applied live? Proven cryptographically, not assumed.** pip's
`RECORD` hash for `unstructured/partition/html/parser.py` does **not** match the
on-disk file; reverting *only* the `, remove_pis=True)` insertion reproduces the
`RECORD` hash byte-for-byte. That proves upstream ships without the flag and our
patcher added it. Re-running the patcher in-container reports `already-patched`,
exit 0.

**A stale note was found.** `_bmad-output/implementation-artifacts/defects-publish-cycle-2026-10-13.md:147-148`
records "The running container still uses the old image" (image `fe8c46c2`). That
is **contradicted**: the container runs image `sha256:92d3506594a7`, built
13:11:49Z, with the container created 13:12:18Z — 29 s later. Worth correcting in
that document.

**Does docling need an equivalent patch? No — and this is proven, not assumed.**
The concern was legitimate: `.html` **is** on a docling path. `genieai_dataprep_arangodb.py:997`
lists `.html` in `docling_extensions`, `:999` routes it to `docling_document_loader`
when `CONTENT_EXTRACTION_METHOD == "docling"` (the shipped value,
`docker-compose.yaml:1424`), and `appConfig.js:51` accepts `.html` uploads.

But docling's HTML path is **immune by construction**: it parses through
`BeautifulSoup(raw, "html.parser")` (`docling/backend/html_backend.py:153`), which
never constructs lxml `_ProcessingInstruction` nodes at all — and `grep -rln
unstructured docling/` returns empty, so docling does not share the vulnerable
code. Verified behaviourally in the live container against PI-bearing HTML:
`BeautifulSoup('<xml?><html><body><p>real content</p>…', 'html.parser')` yields
`['html','body','p']` with content preserved, and
`unstructured.partition_html` on the same input partitions cleanly with no
`AttributeError`.

**Conclusion: the managed patch is correct, minimal, necessary, live, and
sufficient. The scratch copy was a verification artefact and is correctly
disposable.** The gap was in my explanation, not in the repo.

### Follow-up: the "is it actually load-bearing?" question

One reader raised a fair objection — `partition_html` looked like it had no
caller in the dataprep pipeline, which would make the patch defensive rather
than load-bearing. Its adversarial verification came back **REFUTED**, and two
other readers closed the question:

1. **The unstructured branch is reachable.** When `CONTENT_EXTRACTION_METHOD`
   is `opea` (not the `docling` default), `document_loader` at
   `genieai_dataprep_utils.py:214` delegates non-PDF to OPEA v1.5
   `comps/dataprep/src/utils.py:load_html` → `UnstructuredHTMLLoader` →
   `unstructured.partition.html`. The patched code is on a live path.

2. **Falsification proves it.** Swapping the constructor back to
   `remove_comments=True` on the shipped image **reproduces the exact
   `AttributeError: 'lxml.etree._ProcessingInstruction' object has no attribute
   'is_phrasing'`**. With `remove_pis=True`, `partition_html`, `partition_md`,
   and comps `load_md` / `load_html` all succeed on PI-bearing input. The patch
   is load-bearing, not defensive.

**The scratch copy is byte-identical to the patched file in the shipped image**
(md5 `6a73dfb66b3622007a07778cdad6715d`) — it is a copy of the patch's *output*,
which is the strongest available evidence that it carries nothing the managed
artefact does not.

### Two caveats this investigation surfaced

1. **Crawled HTML never reaches dataprep as HTML.** `crawlWorker.js:132` writes
   `${fileId}.md` after turndown conversion, so crawled pages take the `.md`
   branch. The `.html` → docling path is for **direct uploads only**.

2. **The cloud HTML path may differ from the one verified here.** When
   `DOCLING_ENDPOINT` is set — Ansible emits it whenever `gpu_node_host` is
   non-empty, i.e. on cloud deployments — `.html` files are delegated to a remote
   `docling-serve` (`genieai_dataprep_utils.py:127`) rather than the in-process
   converter. The BeautifulSoup immunity above was verified against in-process
   **docling 2.45.0 / docling-core 2.44.2**. The remote service's version is not
   pinned by anything this investigation checked, and the reasoning depends on
   the HTML backend being BeautifulSoup-based. **Worth confirming against the
   deployed `docling-serve` before treating the cloud path as equally safe.**

---

## BUG-11 — The product writes `type: index`, recognises it as valid, then flags it INVALID_TYPE with no remedy · **!1077**

**Status: OPEN** · Severity: high · Found 2026-10-15, wizard step 8 (Auto-correct), live

**Symptom.** `index — INVALID_TYPE: type "index" not in topic|entity|process|event|source`,
with no way to fix it.

**Root cause — three code paths disagree about whether `index` is a valid type:**

1. `crawl-conversion-service.js:709` **writes** `type: 'index'` on the bundle root.
2. `concept-meta-service.js:157` **recognises** it as load-bearing:
   `is_index: fm.type === 'index' || path === 'index.md' || p.concept_id === 'index'`,
   and `bundle-export-service.js:93` finds the root via `rows.find(r => r.is_index)`.
3. `concept-meta-service.js:991` **rejects** it:
   `AUTOCORRECT_TYPE_ENUM = ['topic','entity','process','event','source']` — no `index`
   — so `:1003-1007` emits `INVALID_TYPE`.

It is **warn-only by design** (`:1000`: *"warn (don't change) if outside enum"*), which
here makes the flag **unresolvable by construction**. And `grep` for `INVALID_TYPE` across
`Validate.vue` and the editor components returns nothing — every sibling rule in that
step has a remedy rendered beside it (*Suggest links*, *Link N pages*, *Redact all*,
*Delete one member*). This one has no branch.

**Live state — and why it is not self-correcting.** Neither live index page now carries
`type: index`:

| Repo | `frontmatter.type` | `is_index` | `path` |
|---|---|---|---|
| NCD Information | `topic` | true | `index.md` |
| Alphabet Company Information | `entity` | true | `index.md` |

`is_index` survives only through the **`path === 'index.md'` fallback** at `:157`; the
type-based branch is doing no work. The type was reassigned to a taxonomy value that does
not describe the page, and root-page identification silently degraded to a filename
coincidence. Nothing reports that divergence.

**Direction.** Two paths cannot both be right. Either `index` is a valid type — in which
case `AUTOCORRECT_TYPE_ENUM` is missing a value the product writes, and adding it removes
the false positive at source — or the taxonomy genuinely excludes it, in which case
`crawl-conversion-service.js:709` writes a value it does not accept and the writer should
change. The OKF spec decides which. Separately, every rule should either offer a remedy or
be rendered as explicitly advisory: a blocking-looking row with no action leaves the
curator unable to tell actionable from noise. Add a test asserting the value written at
`:709` is accepted by the enum at `:991` — the two lists are maintained independently,
which is how they drifted.

**Related:** !1076 / Story 10.8 (same step, remedy panels that vanish), !979 (`is_index`
lost on bundle roots typed other than index).

## BUG-10 — Accepting one link suggestion unmounts all the others · **!1075**

**Status: OPEN** · Severity: high (data entry blocked) · Found 2026-10-15, wizard step 7 (Validate), live on the local build · **!1075**

**Symptom.** *Link suggestions show, and when one link suggestion is accepted,
they all disappear.* Not cleared — every remaining un-accepted proposal vanishes
at once, including the one just accepted.

**Root cause — the suggestion list is rendered as a descendant of the very issue
it remediates.**

`components/gov-chat-frontend/src/components/okf/steps/Validate.vue`, nesting
from `:86`:

```html
<div v-if="issue.type === 'orphan' && !frozenAt">              <!-- :86  the orphan issue ROW -->
  <DsButton @click="onSuggestLinks(issue.concept_id)">Suggest links</DsButton>
  <div v-if="suggestFor === issue.concept_id && suggestion">   <!-- :95  suggestions live INSIDE the row -->
    <ul>
      <li v-for="p in suggestion.proposals" :key="p.to_concept_id">   <!-- :103  every proposal -->
        <DsButton v-if="p.accepted" variant="ghost" small disabled>Done</DsButton>  <!-- :106 -->
        <template v-else>
          <DsButton @click="onAcceptLink(issue.concept_id, p)">Accept</DsButton>    <!-- :111 -->
```

And `onAcceptLink` (`:615-628`):

```js
if (res && res.ok) {
  proposal.accepted = true;
  this.refresh();   // :627  comment: "the orphan issue clears once the page is linked"
}
```

**The sequence:**

1. A page has no links → it appears in the validation report as an `orphan` issue,
   so the row at `:86` exists.
2. *Suggest links* renders the proposals — but **inside that row**.
3. Accepting the **first** proposal gives the page a link, which **cures the
   orphan condition**.
4. `refresh()` re-fetches the report, the orphan row is gone, and the
   suggestions `<div>` at `:95` — being its descendant — **unmounts with it**.
5. Every remaining proposal is destroyed, not cleared. `proposal.accepted = true`
   and `p.dismissed = true` write to objects that no longer have a subtree.

**The design intent proves this is a bug, not the behaviour.** `:106` renders a
**"Done"** button for an accepted proposal — an explicit affordance for the
accepted row to *stay in the list and show its resolved state*. That button can
never be seen, because the list is torn down one click earlier. The author built
the resolved-state view and then destroyed it one interaction earlier.

**Impact.** A page with several link proposals can only ever have **one** accepted
per *Suggest links* round. The curator must re-invoke *Suggest links* on the page
for each remaining proposal — but by then the page is no longer orphaned, so the
orphan row (and therefore the entry point at `:87-94`) **no longer renders at
all**. The remaining proposals become **unreachable through the UI**, and the only
way to create those links is the editor.

That is a hard dead-end for the remediation path the step exists to offer: *orphan
→ suggest links → accept*. It works exactly once.

**Direction.** Hoist the suggestions panel out of the per-issue `v-for` and render
it once at panel level, keyed on `suggestFor`, so its lifetime is tied to
`suggestFor` rather than to the orphan row's existence. `proposals` is already
single-concept (`suggestFor` holds one concept id), so one panel at panel level is
sufficient and needs no per-issue placement. Accepting a proposal should mark it
`accepted` and leave the rest visible — which is what `:106` was already written
to do.

Worth noting the same nesting hazard applies to the neighbouring remedies in this
step (`wireExisting` at `:176`, `Sources` creation at `:181`), which also sit
inside their issue rows and also call `refresh()`.

## BUG-07 — Saved frontmatter loads correctly but renders invisible (root cause: BUG-06)

**Status: OPEN — no separate issue; filed as symptom 2 of !1069** · Severity: high · Found ~15:37 on tier 0

**Symptom:** opening the frontmatter editor in the studio editor the first time,
the frontmatter the operator had already created and saved was **not displayed**.
The panel looked empty.

**The read path is correct — verified end to end, not assumed.** Each link was
read and checked:

| Link | File:line | Verdict |
|---|---|---|
| Panel watcher | `FrontmatterPanel.vue:229-236` | `watch: { repoId: { immediate: true, handler(id) { if (id) this.loadFrontmatter() } } }` — fires on mount |
| Loader | `FrontmatterPanel.vue:251-264` | `getFrontmatter(repoId)` → flattens rows into `shape` |
| Row builder | `frontmatterService.js:44-91` | **approved-agnostic** — emits a row per value in every array; `approved_at` is merely `null`. Emits regardless of `_approved` |
| Envelope unwrap | `frontmatterService.js:46` | `res.data.data \|\| res.data \|\| res` |
| Route + handler | `repos-routes.js:19` → `repository-controller.js:279` | `res.status(200).json(repo)` — **no envelope wrapper**, so `res.data` *is* the repo doc and the unwrap resolves correctly |
| Projection | `repository-service.js:124-131` | `toResponse(doc)` spreads the whole doc and deletes only `_id`/`_rev`/`_key` — **`frontmatter` is passed through intact** |

So the tags were fetched, flattened, and written into `shape`. **The data was
present. It was rendered and could not be seen.**

**Why it is invisible.** From `FrontmatterPanel.vue`'s style block:

```css
.okf-fmp              { background: var(--color-surface-raised);   /* undefined */
                        border: 1px solid var(--color-border-subtle); }
.okf-fmp__tag         { background: var(--color-surface-base);     /* undefined */
                        border: 1px solid var(--color-border); }
.okf-fmp__tag-value   { color: var(--color-text);                  /* undefined */ }
.okf-fmp__field-name  { color: var(--color-text-muted);            /* undefined */ }
.okf-fmp__field-count { color: var(--color-text-faint);            /* undefined */ }
```

None of those custom properties exist anywhere in the application (see BUG-06 —
the theme defines 127 tokens in the `--surface` / `--fg` / `--muted` / `--border`
vocabulary, and zero `--color-*`). Per CSS, a `var()` with no fallback and no
matching custom property is **invalid at computed-value time**: the declaration
computes to the property's *initial* value, so every `background` above becomes
**transparent** and every `color` becomes **inherited**. The chips carry no
surface of their own and take their text colour from whatever ancestor they land
in — which in a dark shell is dark-on-dark.

**Why the operator concluded the data was missing.** The panel also renders
`suggestedForbidden` chips with `background: var(--accent-muted, …)` and
`border-color: var(--accent, …)` — and `--accent` / `--accent-muted` **do**
exist. So the moment any suggestion is present, that one chip renders visibly and
correctly, next to invisible saved chips. The visible/invisible mixture reads as
"the load failed and only suggestions came through", which is precisely the wrong
diagnosis — it sent the operator to re-run the LLM suggestion (15:37:18) when the
original tags had loaded correctly all along.

**Confirmed harmless:** `frontmatter_history` holds 4 entries and all four are
byte-identical (15:30:15, 15:30:31, 15:38:03, 15:39:22) — same 4 topic, same 6
entity, same 6 forbidden, same scope and summary. Nothing was lost; the operator
simply could not see what they had saved, and paid a redundant ~45 s vLLM call
plus two extra head rebuilds trying to make it appear.

**Fix: BUG-06.** Rewriting the two files onto the shipped token vocabulary fixes
both this and the light-mode-in-dark-mode report, because they are one defect with
two symptoms. **A regression test is required here specifically** — assert that
after `loadFrontmatter()` resolves with N saved values, those N chips are
*visible* (e.g. a computed-style check that `background-color` is not `transparent`
and `color` is not inherited), not merely present in the DOM. A presence-only
assertion passes today, which is how this shipped.

---

## BUG-05 — Step 10 "Handoff" dead-ends with no pointer to the next surface

**Status: OPEN** · Severity: low · Found 15:41 on tier 0 · **!1068**

`steps/Publish.vue` is titled **Handoff** and correctly refuses to publish — that
is a deliberate directive (`Publish.vue:1-4`: *"KEEP PUBLISHING OUT OF THE WIZARD.
I MEANT IT."*). But its only affordance is **"Open the Dashboard"** (`:55-57`),
and it does not say what the dashboard ritual is.

The lifecycle is **one contextual button** relabelling itself across four states
(`StudioDashboard.vue:695-703` against `CONTEXTUAL_LABELS` at `:410-416`):

| State | Button | Effect |
|---|---|---|
| `draft` | Submit for review | → `review` |
| `review` | Approve | → `approve` |
| `approve` | Publish | opens the confirm dialog (`onLifecycle:809-814` does **not** fire directly) |
| in dialog | Acknowledge and Publish | → `publish`, mints the version |
| `publish`, not ingested | Ingest | drain begins → "Ingesting…" |

That the same button becomes four different buttons is not discoverable from the
Handoff step. A one-line hint on that step — *"On the dashboard, click this card's
button four times: Submit → Approve → Publish → Ingest"* — costs nothing.

---

## Run log — tier 0 (Alphabet Company Information)

Repo `42b2f2df-880c-4ed5-9208-7b36f05a8029`, domain "Alphabet Company",
bundle `alphabet-company-information-llm-v7.zip`.

| Time | Audit action | Detail |
|---|---|---|
| 15:18:52 | `repo.create` | Created in domain "Alphabet Company" |
| 15:18:52 | `repo.import` | 1 concept (index skeleton) |
| 15:19:07 | `repo.import` | **18 concepts**, 18 stored as parsed rows |
| 15:29:35 | `repo.pii_bulk_accept` | **17 flagged concepts**, scan-free |
| 15:30:18 | `repo.update` | frontmatter + history saved (Curate) |
| 15:30:44 | `repo.autocorrect` | 17 change(s) — see BUG-02 |
| 15:30:56 | `repo.topic_links.start` | whole-corpus run |
| 15:31:06 | — | 16 proposed, **5 written**, 4 already-linked, **7 self-loops dropped**, 0 dangling, 0 duplicates, 0 failures, 10 095 ms over 17 concepts / 3 batches |
| 15:31:07 | — | validation: 18 concepts, **0 issues, 0 blockers** |
| 15:38:06 | `repo.update` | head rebuilt (redundant refresh — BUG-02) |
| 15:39:25 | `repo.update` | head rebuilt (redundant refresh — BUG-02) |
| 15:40:42 | `repo.submit` | → review |
| 15:40:49 | `repo.approve` | → approve |
| 15:41:12 | `repo.version_mint` | version 1 (`okf:v1`), 18 concepts |
| 15:41:15 | `repo.publish` | bundle `alphabet-company-information-v1.zip` stored |

**Tier 0 expectation vs observed:** 18 in → 18 out, **0 splits** — matches the
negative control exactly (`alphabet-company-information-llm-v7.zip` has nothing
over the 250 000 ceiling). Truncation: none possible at this size.
