# GENIE.AI Documentation Structure — Comparative Study & Recommendation

**Date:** 2026-09-29
**Author:** docs audit (Wave 77 close-out)
**Scope:** propose a section ordering for `site/content/en/docs/` consistent with industry best practices (Diataxis, Divio, Arc42, Write the Docs)

---

## 1. Problem statement

The current sidebar (post-MR-396 / comprehensive review) has 15 sections.
They were organised by *artifact type* (deploy/, configure/, operate/,
frontend/, backend/, mobile/, …) rather than by *reader task*. This
shows up as concrete defects:

- **Project Overview** — the conceptual entry point — is buried at
  `Core & Project Overview / Project Overview`, four levels down and
  after Deployment/Operations/Observability/Configuration/Architecture.
- **"Core & Project Overview"** mixes four reader tasks in one
  section: Project Overview (concept), Source Tree Analysis (reference),
  Integration Architecture (concept), Development Guide (how-to).
- **Reference and explanation** interleave with no signal: knowledge-base/
  is mixed with architecture/, RAG pipeline details live next to
  Configuration/.
- **The hero CTA on the landing page** (fixed in MR 477) now points to
  `/docs/get-started/` (correct), but the next thing the user reads
  after the quickstarts is "Installation & Configuration" / "Operations"
  — not "What is this thing?".

---

## 2. Frameworks surveyed

### 2.1 Diataxis (Daniele Procida, 2017+)

Four modes, each with a distinct reader question:

| Mode | Reader question | Examples |
|---|---|---|
| **Tutorial** | "Can you show me how?" | Learning-oriented, safe, complete |
| **How-to** | "How do I …?" | Task-oriented, recipe, assumes competence |
| **Reference** | "What is this thing?" | Information-oriented, dry, exhaustive |
| **Explanation** | "Why does it work this way?" | Understanding-oriented, discursive, opinionated |

Key principles:
- Strictly separate the four modes. **Don't mix** them in a single
  document or section.
- Tutorials are for newcomers; how-to and reference are for working
  practitioners; explanation is for the curious expert.
- The order should match the journey: **tutorials → how-to →
  reference → explanation** (or any order *as long as* each is grouped
  separately).

Reference: https://diataxis.fr/

### 2.2 Divio (Daniele Procida, same author, more colloquial form)

Same four-quadrant model as Diataxis, presented as a quadrant diagram:
"Tutorial", "How-to guide", "Reference", "Explanation" (a.k.a.
"Discussion" / "Background"). Divio's contribution is the emphasis
on **diagnosis** — most bad docs are bad because they confuse the
quadrants.

Reference: https://documentation.divio.com/

### 2.3 Arc42 (Dr. Gernot Starke, Peter Hruschka, ~15 years)

Twelve-section template for **architecture documentation**. Specifically
about the "Explanation" quadrant, in particular system architecture.

| # | Section | Purpose |
|---|---|---|
| 1 | Introduction & Goals | Quality goals, stakeholders |
| 2 | Architecture Constraints | Technical, organisational, conventions |
| 3 | System Scope & Context | Business + technical context, external interfaces |
| 4 | Solution Strategy | Fundamental decomposition decisions |
| 5 | Building Block View | Static decomposition (white-box) |
| 6 | Runtime View | Dynamic scenarios (use cases, sequences) |
| 7 | Deployment View | Infrastructure, mapping of blocks to infra |
| 8 | Concepts | Cross-cutting, domain rules |
| 9 | Design Decisions | ADR-style log |
| 10 | Quality | Quality scenarios, trade-offs |
| 11 | Risks & Technical Debt | Known limitations |
| 12 | Glossary | Domain terms |

Reference: https://arc42.org/

### 2.4 Write the Docs (community)

General best-practice guidance:
- **Lead with the user's question, not the project's structure.**
- **Search-first design** — every page should be reachable via
  keyword search of the reader's actual question.
- **Scannable** — headings, bullets, code, no prose walls.
- **Task-oriented navigation** — "How do I deploy?" not "Configuration".
- **Examples before theory.**

---

## 3. Mapping current sections to the four modes

| Current section | Diataxis mode | Notes |
|---|---|---|
| `get-started/` | **Tutorial** | 5 quickstarts, all learning-oriented |
| `deploy/` | **How-to** | "Install / compose / swarm" — task recipes |
| `configure/` | **How-to** | "Configure X" — task recipes |
| `operate/` | **How-to** | "Run / scale / backup / troubleshoot" — task recipes |
| `contribute/` | **How-to** | "Open an MR / style guide" — task recipes |
| `architecture/` | **Explanation** | C4 diagrams, auth flow, OPEA — understanding |
| `rag-pipeline/` | **Explanation** | Retrieval, labeling, generation — understanding |
| `knowledge-base/` | **Explanation** | Content guidance, ingestion log — understanding |
| `core/integration-architecture.md` | **Explanation** | Cross-part wiring |
| `core/project-overview.md` | **Explanation** | High-level orientation |
| `core/source-tree-analysis.md` | **Reference** | Repo tree (factual lookup) |
| `core/development-guide.md` | **How-to** | "Build and run locally" — task recipe |
| `backend/`, `frontend/`, `mobile/` | **Reference** | Component inventory |
| `observe/` | **Mixed** | tracing.md, dashboards.md, alerting.md = mixed how-to + reference |
| `reference/` | **Reference** | API contracts, env vars, glossary, routes |

### 3.1 Defects identified

1. **`observe/` mixes how-to (tracing, alerting) with reference
   (configuration, dashboards)** — bad per Divio.
2. **`core/` mixes reference (source-tree-analysis) with how-to
   (development-guide) with explanation (project-overview,
   integration-architecture)** — three modes in one section.
3. **`backend/`, `frontend/`, `mobile/`** sit between operational
   reference (env vars, routes) and contributor how-to. They are
   **component-reference** docs, but their position makes them feel
   like second-class citizens after Architecture.
4. **`knowledge-base/` lives between RAG Pipeline and Mobile** with no
   signal to the reader. It is *content-curation guidance*, not a
   pipeline mechanic.

---

## 4. Recommendation

### 4.1 Target sidebar order (Diataxis-aligned)

```
1. Tutorials                  → /docs/get-started/
   (welcome, 4 quickstarts, concepts, glossary, FAQ, where-to-next)

2. Concepts                   → /docs/concepts/
   project-overview
   architecture-overview      (merged from current architecture/architecture.md)
   auth-flow                  (split out from architecture)
   rag-pipeline/              (reorganized: pipeline, labeling, contextual,
                                generation, streaming-sse, per-request-overrides,
                                multi-turn-retrieval, streaming-translation,
                                model-capability-cache, choosing-models)
   knowledge-base/            (content-guidance, ingestion-log, document-lifecycle)

3. How-to guides              → /docs/how-to/
   deploy/                    (compose, swarm, gpu, topologies, a40-install,
                                install-guide)
   configure/                 (branding, cors-csp, dashboard, deployment-flavors,
                                external-idp, keycloak-admin, locale-whitelist,
                                local-dev-self-signed)
   operate/                   (admin-logs, backup-restore, health-checks,
                                scaling, security-hardening, troubleshooting,
                                updates)
   contribute/                (add-a-doc, dev-workflow, how-to-mr, i18n,
                                release-process, repo-layout, security-triage,
                                style-guide)
   development-guide          (was core/development-guide.md)
   troubleshooting & FAQ      (per-bucket pages)

4. Reference                 → /docs/reference/
   api-contracts              (REST endpoints)
   routes                     (UI routes)
   env-vars                   (full table)
   service-registry           (Compose service inventory)
   arangodb-collections       (DB schema)
   opea-protocol               (OPEA wire protocol)
   glossary
   source-tree-analysis       (was core/)
   backend/, frontend/, mobile/ (component references — moved here)
   observe/configuration     (was observe/_index.md config + dashboards.md ref)
```

### 4.2 Why this order

- **Tutorials first** — the entry point for a new reader. Match the
  landing-page hero CTA. Already correct.
- **Concepts second** — explain the *what* and *why*. Project
  Overview first, then architecture, then the AI pipeline, then the
  content model. This is where the "Core & Project Overview" section
  gets unpicked and dispersed where it actually belongs.
- **How-to third** — recipes for the operator who has a task. Already
  roughly correct, just needs `development-guide` moved here and the
  observe/ mixing fixed.
- **Reference last** — look-up material. The user has a question and
  wants the exact answer.

### 4.3 Cross-cutting concerns

- **Search** — Hugo's built-in search (Docsy). Re-index after the
  restructure. Every page needs a searchable title and frontmatter.
- **Breadcrumbs** — current breadcrumbs already work (Docsy default).
  No change.
- **TOC** — each page's `On this page` TOC is generated from H2/H3.
  Section renaming will not affect it.
- **Aliases** — every moved page needs `aliases:` pointing to its
  old path so existing links don't 404.

### 4.4 What gets deleted in the restructure

- **`core/` section** — split:
  - `project-overview.md` → `concepts/project-overview.md`
  - `integration-architecture.md` → `concepts/integration-points.md`
    (or merge with `concepts/architecture-overview` if shorter)
  - `source-tree-analysis.md` → `reference/source-tree-analysis.md`
  - `development-guide.md` → `how-to/build-and-run.md`
- **`observe/` split**:
  - `tracing.md` (mostly how-to) → `concepts/observability-tracing.md`
  - `dashboards.md` (mostly reference) → `reference/observability-dashboards.md`
  - `alerting.md` (mostly how-to) → `how-to/triage-alerts.md`
  - `configuration.md` (mostly reference) → `reference/observability-config.md`
- **`backend/`, `frontend/`, `mobile/`** stay under those names but
  are visually grouped in the sidebar as "Component reference"
  (sidebar ordering only, file paths unchanged).

---

## 5. Implementation cost

- **Files to move:** ~30 (most of `core/`, split of `observe/`, all
  reference pages).
- **Aliases to add:** ~30 (one per moved page, plus the section
  root).
- **Internal links to fix:** every cross-reference between the moved
  pages. Most should resolve via Hugo's `relref` lookup, but a
  handful of hard-coded `/docs/core/...` paths will need updates.
- **Section landing pages** (`_index.md`) need rewriting or merging:
  - `core/_index.md` → split into `concepts/_index.md` and
    `reference/_index.md`
  - `observe/_index.md` → split into `concepts/observability/_index.md`
    and `how-to/observability/_index.md` and
    `reference/observability/_index.md`
- **Sidebar ordering** — adjust the `weight:` frontmatter across all
  section `_index.md` files to produce the desired order.

Estimated: 1 large audit wave + 2 fix waves to reach clean again.

---

## 6. Risks

- **Link rot** — moving pages breaks any external links pointing to
  the old paths. Aliases catch the in-repo `relref` cases; raw URLs
  from external sources still 404. Mitigation: keep the `aliases:`
  block in every moved page pointing at the old path; verify with
  Wave A28 cross-reference check.
- **User disorientation** — readers who bookmarked
  `/docs/core/project-overview/` lose their shortcut. Mitigation:
  the `aliases:` frontmatter handles redirects; a one-time note in
  `CHANGELOG.md` flags the move.
- **Content drift during the move** — while pages are being
  relocated, the `git diff` will show moves as renames if the
  content is unchanged, which is good for the audit. But the
  restructuring introduces enough path changes that the audit must
  re-verify all internal links.

---

## 7. Alternatives considered

- **Diataxis 4-section pure** (Option B in the previous proposal) —
  same as this recommendation but without the Arc42 grounding in
  Concepts and without the explicit split of `core/` and `observe/`.
  Strict, simple, but leaves the question of "where does Source Tree
  Analysis go?" unanswered.
- **Keep current, reorder only** (Option A) — moves Project
  Overview up, renames "Core & Project Overview" to "Engineering
  reference". Lowest effort, but the section-mixing defect persists:
  `core/` will still mix reference + how-to + explanation.
- **Status quo** — not acceptable. Project Overview is buried, the
  reader's first click after the quickstarts is a how-to for
  operators, and `core/` mixes three Diataxis modes.

---

## 8. SUPERSEDED — Wave 78 audit rejection

**Status (2026-09-29):** Wave 78 independently reviewed this study
and rejected the proposed 4-section restructure. See
`/tmp/audit/wave78-done.md` for the full review.

### Why this study was rejected

- **The "Concepts" bucket is a 5th Diataxis mode I invented.** Diataxis
  defines 4 modes (tutorial/how-to/reference/explanation). The
  proposed `concepts/` section would absorb 5 explanation + 6 how-to
  + 5 reference pages — i.e. **the same 3-mode mixing defect this
  study diagnosed in `core/` and `observe/`, relocated one level up**.
- **Internal contradiction in the moves.** The proposed moves
  routed `observe/tracing.md` (mode: how-to) to the Concepts bucket
  (explanation), and `observe/alerting.md` (mode: reference) to
  how-to. The audit caught this; the study did not.
- **The `mode:` frontmatter already classifies all 92 pages.** Every
  body page declares its Diataxis mode in frontmatter (36 how-to /
  35 reference / 16 explanation / 5 tutorial). A reader-pivot nav on
  `mode:` would deliver most of the stated benefit without moving a
  single file. The 4-section restructure solves a problem the
  taxonomy already solves.
- **`backend/` is an empty stub** (28-line landing, 0 body pages).
  The study treated it as a populated reference section.
- **Cost estimate understated by 3-4×** (10 file moves vs 2-3 audit
  + 2-3 fix waves).
- **Diataxis citation error** in the Divio line (Procida vs Laing).

### What the audit recommended instead (lean fix)

Keep the 14 sections. Adjust `weight:` values so the reader's first
click after the quickstarts is no longer a how-to for operators.
Move ~6 files that are misclassified in their current section.
Reconcile the glossary duplication. Delete the empty `backend/`
stub.

No new directories. No 5th Diataxis bucket. The cost is bounded and
the risk is minimal.

### Implementation plan (lean fix)

**Commit 1 — IA reorder (weight + landing-page cards).**

Touch `weight:` in 10 `_index.md` files + update the 14-card grid in
`site/content/en/docs/_index.md` + update the section table in
`contribute/add-a-doc.md`. No file moves.

**Commit 2 — file moves to remove mode-mixing.**

- `core/source-tree-analysis.md` → `reference/source-tree-analysis.md`
  (mode: reference; matches section)
- `core/development-guide.md` → `contribute/build-and-run.md`
  (mode: how-to; matches section)
- `observe/tracing.md` → `operate/tracing-howto.md`
  (mode: how-to; lives with operator how-tos)
- Glossary reconciliation: keep `reference/glossary.md`; delete
  `get-started/glossary.md` (or convert it to a redirect via frontmatter alias)
- Delete `backend/_index.md` (empty stub)

### Why the audit's lean fix is the right call

- The 4-section restructure would have shipped an IA **less**
  internally consistent than what exists today.
- The reader's actual complaint ("Project Overview is buried")
  is solved by weight reordering alone — no file moves needed.
- The mode taxonomy makes a separate Concepts bucket redundant —
  readers can find any tutorial/how-to/reference/explanation page
  alphabetically via a single "By mode" index page (a 1-page
  addition deferred to a later iteration).

---

## 9. References

- Diataxis — https://diataxis.fr/
- Divio — https://docs.divio.com/documentation-system/
  (correction: the study initially attributed the "Grand Unified Theory of
  Documentation" to Daniele Procida; canonical attribution is David Laing.
  Procida developed Diataxis independently.)
- Arc42 — https://arc42.org/
- Write the Docs — https://www.writethedocs.org/

---

## 9. References

- Diataxis — https://diataxis.fr/
- Divio — https://documentation.divio.com/
- Arc42 — https://arc42.org/
- Write the Docs — https://www.writethedocs.org/
- Google Season of Docs — https://developers.google.com/season-of-docs