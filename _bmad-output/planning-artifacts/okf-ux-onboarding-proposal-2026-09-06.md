# OKF UX Onboarding & Guidance Proposal
## For users less acquainted with OKF, markdown, and the curation system
(David, 2026-09-06 — "explain what to do, when and why; explain how to get the
best RAG results")

## Personas

| Who | Knows | Doesn't know | Needs |
|---|---|---|---|
| **The Curator** (primary) | Their domain (e.g. public services) | OKF concepts, markdown, why labels matter | To be guided step-by-step; plain words; no syntax |
| **The Steward** (approver) | The domain + quality bar | The pipeline internals | To see what changed and what's left; approve fast |
| **The Operator** | The system | — | (served by docs today) |

## Five principles (acceptance criteria for every surface)

1. **Intent-first copy** — every step states WHAT to do, WHEN in the flow, and
   WHY it matters ("Labels tell the assistant which topics a chunk answers —
   unlabeled concepts may never be retrieved").
2. **Generous labeling** (David, 2026-09-06): the UI is HEAVILY annotated —
   every field, button, tab, state and term carries a label and/or explanatory
   line. Silence is a defect: if a user has to guess what something is or does,
   the copy is missing. Hints, sublabels, ⓘ tooltips and empty-state text are
   the norm, not decoration.
3. **The pipeline is visible** — the user always knows where they are in the
   six steps and what comes next. Raw state words (DRAFT, REGISTER) are
   replaced by position + action ("Step 2 of 6 · Review & label").
4. **Review-by-exception** — the system curates automatically (Auto-Curate
   Pass, spec 19493fa); the user sees a short work queue of only what needs
   judgment, with one-click accept.
5. **Guardrails before errors** — disabled buttons state the reason; destructive
   actions state consequences in plain language; nothing punishes with jargon.
6. **Every action ties to a RAG outcome** — curation is not paperwork; it is
   "how the assistant finds and answers with your content".
7. **Everything is i18n** (David, 2026-09-06): ALL of this copy — every label,
   hint, tooltip, explanation and message — goes through vue-i18n with keys in
   `src/i18n/locales/`, complete across ALL 14 locales (the
   localeConsistency test enforces identical key sets). No hardcoded strings in
   components, ever.

## Flow-by-flow changes

### A. Orientation (new, small)
- **Pipeline stepper** on the dashboard card + editor shell: the six steps
  (Import → Review & label → Approve → Publish → Make available → Retire)
  with the current position highlighted and the next action named.
  Replaces the raw lifecycle_state pill for non-expert users (state pill stays
  for experts via a toggle).
- **ⓘ information icon next to EVERY term** (David, 2026-09-06): every domain
  word that appears in the UI — Frontmatter, concept, Subject Area, label,
  bundle, version, serving, ingestion, classification, re-split, … — gets an
  ⓘ icon beside it with a one-paragraph plain-language explanation (what it
  is, why it's there, what the user is expected to do with it). One consistent
  reusable component (`DsInfoTip`) fed from a single i18n glossary; never a
  docs link as the first resort. Frontmatter, for example: "The structured
  information at the top of each file — type, title, labels. The assistant
  uses it to know what each concept is about."
- **First-run empty states**: the dashboard's empty lanes get a 3-step "how it
  works" mini-tour instead of blank space.

### B. Import flow (merge two scattered entries into one)
- **One "New repository" entry** with two plain cards: "From a web crawl" /
  "From a zip bundle". Each field carries intent copy:
  - Subject Area — "Where does this knowledge belong? It groups your
    repository and focuses which labels you can choose."
  - Classification — "How should we categorize the content? Automatic
    (recommended) reads each page; you can correct types later."
- **Self-explaining progress**: stages in human words ("Fetching pages →
  Building concepts → Checking for private data → Organising links") plus a
  "what happens next" line ("Nothing is published — next you review and label").
- **Post-import report** (with Auto-Curate AC-1): "Your repository is ready:
  999 concepts · 1,199 links between topics · 997 typed · 74 labeled.
  Next: label the remaining 925 — we've suggested most of them."

### C. Editor (the markdown barrier)
- **AUDIT FINDING (live, 2026-09-06): the Frontmatter bar is DEAD UI** — a
  bar labeled "Frontmatter" with tabs Preview / Split / Source only renders
  NOTHING and the tabs DO NOTHING (David's screenshot). Dead controls are the
  worst UX defect class: they teach users the UI lies. Fix or remove: either a
  working Frontmatter panel (parsed fields shown read-only beside the mode
  tabs, editable via the {frontmatter} PATCH mode) integrated with the mode
  tabs (Preview = rendered markdown · Split = side-by-side · Source only =
  textarea + formatting toolbar), or the bar goes away entirely. Every control
  must do what its label says.
- **Edit / Preview / Split / Source-only modes that WORK** — rendered preview
  beside or above the markdown source. The single biggest barrier for
  non-markdown users; no WYSIWYG complexity, just see-what-you-get feedback.
- **Markdown formatting toolbar in source mode** (ticketed): bold/italic/
  headings/lists/links/code/table inserting at the cursor — with tooltips
  showing the syntax each button writes.
- **Label picker with meaning**: each option shows its Knowledge-Hierarchy
  path; suggested labels (from AC-3) appear as one-click chips with confidence.
- **Validate step as a plain-language checklist** with inline actions:
  "✔ Every concept has a type · ⚠ 925 concepts need labels → [Label with
  suggestions] · ✔ All links resolve · ⚠ 2 possible duplicates → [Review]".
  Each line links to why it matters for answers.

### D. Lifecycle actions
- Consequence lines on every action (Publish's dialog is the precedent):
  - Submit — "Sends your repository for approval. You can keep editing."
  - Ingest — "Makes the approved version available to chat answers. You can
    retract it any time."
  - Retract — "Takes the version out of answers. Your content is kept and
    editable; nothing is deleted."
- Serving repos say WHY they're read-only: "This version is live in answers —
  retract to edit it."

### E. RAG-results guidance (persistent, small)
- **"Getting the best answers" panel** (dashboard side panel / help drawer):
  label coverage decides which questions can be answered · links let the
  assistant reason across topics · only published, ingested versions answer ·
  versions let you roll back.
- **Quality meter** from the coverage score with interpretation:
  "Labels: 8% — questions about unlabeled topics may be missed."

### F. Safety rails
- Delete/retract with plain consequences + type-to-confirm on large repos.
- Partial-failure framing: "978 of 999 concepts imported — review the 21
  skipped" instead of silent partials.

## Delivery plan (rides existing waves)

| Slice | Content | Depends on |
|---|---|---|
| UX-1 | Pipeline stepper + glossary tooltips + empty states | — |
| UX-2 | Edit/Preview toggle + markdown toolbar (ticketed) | — |
| UX-3 | Plain-language checklists in Validate + consequence lines on actions | Auto-Curate AC-1/AC-2 |
| UX-4 | Import merge (one entry) + self-explaining progress + post-import report | AC-1 |
| UX-5 | RAG guidance panel + quality meter | coverage engine (AC-1) |

All copy ×14 locales (i18n discipline); DS components only; intent copy is an
acceptance criterion for every PR that touches OKF UI (memory: UX directive).