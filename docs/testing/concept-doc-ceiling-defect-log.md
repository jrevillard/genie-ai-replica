# Defect Log — Concept Document Ceiling live run

Companion to [concept-doc-ceiling-test-plan.md](concept-doc-ceiling-test-plan.md).
Raised during the operator run on the local build, 2026-10-14.

Status key: **OPEN** / **FIXED** / **FALSE POSITIVE** (my measurement error, not a
product defect) / **WONTFIX**

---

## BUG-01 — PII bulk-accept leaves no visible record of what was accepted

**Status: OPEN** · Severity: high (governance) · Found 15:29:35 on tier 0

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

**Status: OPEN** · Severity: medium · Found 15:30:44 on tier 0

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

**Status: OPEN** · Severity: high (first-run experience) · Found 15:28–15:30 on tier 0

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

**Status: OPEN** · Severity: high (visual correctness, theme-wide) · Found ~15:45 on tier 0

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

## BUG-05 — Step 10 "Handoff" dead-ends with no pointer to the next surface

**Status: OPEN** · Severity: low · Found 15:41 on tier 0

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
