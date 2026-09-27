# ADR okf-042: Wizard clone uses the 4.8 clone API — wholesale copy, no frontend re-import

- **Status**: Accepted (David Forden, 2026-09-27 — Amendment A decision #9)
- **Date**: 2026-09-27
- **Decision owners**: David Forden, Genie.ai Dev
- **Implemented in**: MR !474 (`Choose.beforeAdvance`, clone branch)

## Context

The wizard's Choose step offered "Clone of an existing repository" but
the card was dead — Entry's create-on-advance minted an EMPTY repo and
no source was ever copied. An intermediate implementation re-imported
the source's concepts concept-by-concept from the frontend
(`listConcepts` → per-concept detail fetch → `/import` upsert). The
/adversarial review killed that shape: it cost 40+ round-trips at the
Continue click, carried only `{path, frontmatter, body}` (silently
losing the author graph links, PII review state, index/conformance
state and label confirmations), and one empty-body concept 400'd the
whole batch.

## Decision

Clone in the wizard calls the **sanctioned 4.8 clone API**
(`POST /okf/repos/:source_id/clone`, `repoService.cloneRepository`),
which copies `okf_concepts_meta` rows VERBATIM — links, PII state,
index status, trust tier, conformance issues — records the
`cloned_from` lineage and writes an audit row, compensating on failure.

Because Entry's create-on-advance has already minted the (empty) target
repo holding the steward's chosen `(name, domain)`, and the clone API
mints its OWN repo, the wizard's clone path:

1. Deletes Entry's empty shell (`DELETE /okf/repos/:id` — safe: no
   content, draft only);
2. Calls clone with the draft's `name`/`domain`;
3. **Retries on 409 with backoff** — the delete is an async 202 and the
   duplicate key may still be registered for a moment;
4. Swaps the draft's `repo_id` to the clone (write-back), refreshes the
   repo store, and continues to Input.

Source restriction: only repositories that are NOT yet serving are
cloneable in the wizard (picker filters on `ingested_at`).

## Consequences

- A wizard clone is byte-equivalent to a dashboard/editor clone — one
  code path, one audit trail, no fidelity loss.
- The 409 window is real but bounded; the retry absorbs it and the
  failure copy tells the steward to go Back and Continue again.
- The clone picker must resolve `reposByStage` lane entries through
  `repoById` — the lanes carry repo_id STRINGS (F3 lesson).
- The destroy-and-mint dance exists ONLY because Entry creates before
  Choose chooses; if the step order is ever revisited, prefer seeding
  the source before create and drop the delete.
