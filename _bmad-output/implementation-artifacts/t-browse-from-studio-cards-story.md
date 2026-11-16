# T-slot story — Browse from the Studio repository cards (the W9 browser on the dashboard)

**Status:** IN PROGRESS (2026-11-16)
**Issue:** filed this session (the dashboard Browse work item) — the label + the
i18n x14 + tests acceptance live there.
**Branch:** `feat/browse-from-studio-cards` (off origin/main `ab452e457`, which
carries the merged W9 browser and the #1836 redesign).

## The LOOK (visible delta)

An admin on the OKF Studio dashboard clicks **Browse** on any repository card —
the W9 concept-tree browser opens AT that repository, read-only, without opening
the editor or leaving the dashboard. The same browse a chat citation offers,
from the admin surface.

## Design (grounded in live code)

**StudioDashboard.vue** — a ghost `Browse` button in the card-actions row, after
the contextual lifecycle chip. READ-ONLY, so unlike the mutating verbs it is
offered on EVERY card in EVERY lane and state (a Building/Draining repo can be
inspected while it works), and it carries no `actionBusy` disable. `@click.stop`
keeps the card's `resume` (the heavyweight editor open) silent. Emits
`browse(repo_id)`; `data-test-id="okf-studio-browse"` (E2E locators scope it
under the card wrap's existing `okf-studio-card-<repo_id>`).

**StudioTab.vue** — hosts ONE `ConceptBrowserDialog`, driven by the SAME okf
store browser slice the chat shell's instance reads
(`browserVisible` computed ← `okf/browser`; close → `okf/closeConceptBrowser`).
The admin screen is a ROUTE separate from the chat shell, so the two instances
are never co-mounted — no double render; this one exists because the admin route
cannot see the chat's. `onBrowse(repoId)` dispatches `okf/openConceptBrowser`.

**store/modules/okf.js — `openConceptBrowser` gains the repo-level open.**
`conceptId` becomes OPTIONAL: with it, the citation behavior is byte-identical
(strict validation, tree + CAP-2 fetch in parallel); without it, only the tree
fetch runs — the dialog's existing "Select a concept from the tree to read it
here" empty state is the detail pane, and `openBrowser`'s mutation already
handles a null seed (empty history, `historyIndex −1` until the first visit).
An empty-string `conceptId` stays a VALIDATION_ERROR: that is a broken citation,
not a repo-level open. **SHARED FILE — flagged per the admin-UX fence**: this is
the only touched file outside AdminDashboard + its tabs + its dialogs.

**ConceptBrowserDialog.vue — NO behavioral change** (the empty-selection arm
already exists; the #1836 pane-never-unmounts invariant is untouched).

**i18n** — `okf.dashboard.card.browse` in ALL 14 locales, anchored on each
locale's `buildingAria` line (unique to the dashboard card block). The label
derives the VERB each locale already chose for the W9 browser title
(`chatbot.okfBrowser.title`): Browse / Parcourir / Durchsuchen / Explorar /
Explorar / Обзор / استعراض / 浏览 / เรียกดู / Vinjari / Jelajahi / ব্রাউজ / Sheba
/ Browse. Strings inserted verbatim.

## Acceptance

1. Every lane card shows Browse; clicking opens the browser at that repo with
   the progressive tree; the select hint shows until a concept is picked; close
   cancels in-flight walks (the existing close semantics).
2. The label settles in all 14 locales (unit-verified: every locale's module
   parses and carries the key).
3. Unit tests: the dashboard button's emission per lane (incl. Building),
   `@click.stop` not firing `resume`, the action's repo-level/citation-level/
   refusal arms, StudioTab's host wiring (visible state + close through the
   same slice). Coverage does not decrease.
4. E2E locators: `okf-studio-browse` added on the button; it composes with the
   existing card-wrap handles (`okf-studio-card-<repo_id>`, already mapped in
   docs/e2e-tests/locator-map.md for the ragas specs) — no new E2E spec ships
   in this MR, so the map needs no new row.
5. DS primitives only; emit → store dispatch; Options API.

## Non-goals

No editor entry, no write verbs, no chat-surface change, no new backend
endpoints.

## Verification

Recorded at the end of this file when the wave completes.
