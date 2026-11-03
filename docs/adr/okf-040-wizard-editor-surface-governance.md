# ADR okf-040: Wizard/editor surface governance — parity by composition, ritual outside the wizard

- **Status**: Accepted (David Forden, 2026-09-27 — Amendment A decision rounds)
- **Date**: 2026-09-27
- **Decision owners**: David Forden, Genie.ai Dev
- **Implemented in**: MR !474 (Amendment A, `feat/okf-server`)

## Context

The OKF Studio wizard (Epic 3, story 3.4) reached functional equivalence
with the OKF editor through the Amendment A wave. Three governance
questions had to be settled while finishing it:

1. **How does the wizard stay at parity** with an editor that keeps
   evolving (PII panel, autocorrect, graph view, dialogs) without a
   permanent double-implementation tax?
2. **Where does the lifecycle ritual live** — submit → approve → publish?
   The wizard originally carried a publish button (and Review a
   submit/approve button), splitting the ritual across surfaces.
3. **What do serving (ingested) repositories get** from a wizard whose
   steps are creation-oriented?

## Decision

1. **Parity by composition.** The wizard embeds the editor's real
   components rather than re-implementing them: Curate embeds the full
   `OkfRepoEditor` (concept list, markdown/frontmatter editing, labels,
   add/delete, re-split, autocorrect, graph toggle); Validate embeds
   `OkfPiiOccurrences` (identical green RESOLVED / orange flagged /
   re-scan semantics by construction); Review hosts the editor's own
   Versions/Logs/Rename dialogs. A wizard-side duplicate of any editor
   control is a defect, not a feature.
2. **The lifecycle ritual lives ENTIRELY outside the wizard.** The
   wizard prepares the repository (creation → conversion → curation →
   validation); the Editor and Studio dashboard own submit, approve,
   publish and ingest — one surface, one audit trail for sign-off.
   The wizard's final step hands off ("Open the Editor", landing in the
   repo's Editor shell with the Editor sub-tab active). The wizard
   performs no lifecycle transition, ever (`publishRepo()` removed).
3. **Landing rules.** An existing repository opens straight at its saved
   step (`studio_step`, A4); a serving repository gets a read-only
   summary (gate open — no dead ends); "Back to dashboard" remains the
   explicit ghost exit.
4. **Labels are automated, never free text.** The Labels step previews
   the live KH-L2 assignment (bounded to the repository's Subject Area);
   per-topic adjustments happen in Curate. (Supersedes the old
   free-text chip adder, which violated KH-bounded labeling.)

## Consequences

- Editor-only features appear in the wizard automatically as the editor
  gains them — zero parity maintenance on the wizard side.
- Reviewers always sign off on the same surface with the same audit
  records; the wizard cannot mint versions or flip lifecycle state.
- The wizard's Final step gate must never dead-end (live metrics for
  readiness; serving repos open the gate onto the summary).
- The A2 gate contract (steps emit `gate`, the shell disables Continue)
  and A1 write-back (steps emit `update`; patches must SPREAD nested
  objects — the wizard merges shallowly) are the parity contract's
  plumbing and may not be bypassed by future steps.
