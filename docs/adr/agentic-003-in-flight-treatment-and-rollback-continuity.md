# ADR agentic-003: In-flight treatment at flag switch and rollback continuity

- **Status**: Proposed
- **Date**: 2026-11-22
- **Decision owners**: GENIE.AI engineering (operator accepts at merge)
- **Binds**: FR-16 (rollback continuity), spine AD-9 (one flag, both paths), AD-11 (versioned execution records), AD-12 (no new persistence)
- **Story**: [#1973](https://opensource.unicc.org/un/itu/genie-ai/-/issues/1973) — story 3.2, "Rollback continuity"

## FR-29 traceability

```
use case (an operator disables the agentic path while answers are streaming and users keep
  conversations created under the flag)
  -> requirement (FR-16: rollback is demonstrated for every delivered stage — in-flight requests,
     partial responses already streamed, and persisted conversations created by the agentic path
     must each have a defined, tested treatment)
    -> decision (this record: route resolved once per request at entry; an in-flight stream
       keeps its resolved path — it completes only within the stopping process's shutdown
       window, otherwise it ends unanswered like a hard stop; a live-process interruption
       partial-saves with an explicit interrupted marker; persisted agentic conversations
       read and continue on the legacy path unchanged)
      -> investigation (AD-9's single-read flag invariant; AD-12's same-shaped persistence rule;
         the story 3.1 routing tests that already pin the two entries cannot disagree)
        -> merge request (the story 3.2 MR)
          -> validation evidence (the rollback-continuity suite: agentic history on the legacy
             read path, okf citation re-resolution from snapshot rows, the interrupted-marker
             pins on both partial-save paths, the no-output honesty pin)
            -> released version (the merge into feat/agentic-foundations/prd)
```

## Context

The agentic path is live behind one deployment-level flag (AD-9). Three states needed a
contract before rollback is operationally safe:

1. **In-flight requests at switch time.** The flag is read ONCE at module load
   (`services/agent-routing.js` — the single-read invariant story 3.1 pins). There is no
   per-request re-read and no per-conversation marker: an operator cannot retroactively change
   what an already-accepted request resolved to.
2. **Partial responses already streamed.** Both paths share one terminal
   (`QueryService.finalizeStreamQuery`): on a client disconnect with text already streamed, the
   partial answer is saved with `isAnswered: true`. Before this record, a truncated answer
   persisted indistinguishable from a complete one — dishonest history.
3. **Persisted conversations created under the flag.** They must render, re-resolve citations
   and continue on the legacy path with no migration (AD-12). One gap existed: the
   saved-conversation snapshot rows (`conversationFiles`) dropped the okf-concept stable ids
   (`source`, `concept_id`, `repo_id`, `bundle_version`), so a restored sidebar built dead
   `/api/files/<concept_id>/download` URLs for concept citations.

### Constraints

- No new persistence, no migration, no backfill (AD-12): write-time fixes only; existing
  persisted docs stay as they are.
- The five legacy SSE event types are preserved verbatim (AD-8): the honesty fix cannot add an
  event type or change a frame's shape — an additive metadata key on the existing `metadata`
  frame (end-without-completion-frame path only) is the extent of it.
- The legacy path, flag off, answers byte-identically to today (the coexistence contract) — the
  fix may not alter its answering behavior beyond the shared marker.
- The D03 runtime seam and the agent service (Python) are out of scope: this is a BFF-side,
  persistence-side contract.

## Decision

**Route at entry; complete or die honestly; every partial save carries a marker; the persisted
surface already speaks legacy.**

1. **Flag semantics — a rollback is a process restart.** The flag is read once at module load;
   the route is resolved once per request at entry (the shared routing helper both entries call,
   AD-9). Consequence: an in-flight stream keeps its resolved path — a request accepted by the
   agentic process is never re-routed mid-stream; the next request resolves fresh. Whether the
   stream _completes_ depends on the stop: the process's only shutdown handling is the
   observability flush (a bounded window), so an in-flight stream finishes only if it completes
   inside that window — otherwise the process exits and the stream ends unanswered, exactly
   like a **hard stop** (container kill, crash): the client sees the stream end, nothing is
   saved beyond the at-start document, which stays `isAnswered: false` (§3's honest "never
   answered" state). Nothing re-routes mid-stream,
   and no per-conversation routing marker exists — rollback continuity is a data-shape property,
   never a conversation attribute.

2. **Interruption honesty — `answer_interrupted: true` on every partial save.** When a stream
   dies mid-answer with text already streamed on a live process — a client disconnect, or the
   upstream ending without its completion frame — the partial save
   carries `metadata.answer_interrupted = true` alongside the partial text and the metadata
   captured so far. The field is additive metadata — no new SSE event type (it rides the
   existing `metadata` frame additively on the end-without-completion-frame path), and the
   legacy restore ignores unknown metadata keys. Normal completions never carry it (the
   field is written only on the partial-save paths: the agentic frame writer's
   `res.on('close')` handler, the legacy relay's, and the legacy relay's
   end-without-completion-frame branch — one finalize, one honesty contract).

3. **No-output honesty — the unanswered doc stays unanswered.** A stream interrupted before any
   text chunk leaves the at-start `queries` doc exactly as `initStreamQuery` persisted it
   (`isAnswered: false`): nothing is fabricated, the turn reads as "never answered" in
   analytics — the honest state, not a zero-length answer.

4. **Abstention vocabulary parity.** The agentic metadata base normalizes `abstained: false`
   (the legacy _answered_ value) instead of inheriting the empty-stream `null` ("chatqna never
   answered"). An agentic insufficiency answer is an answer — its insufficiency is recorded in
   `grounding_status` / the verdict marking — and abstention analytics must not read an agentic
   turn as "never answered".

5. **Rollback continuity is already true; the snapshot gap is closed at write time.** An
   agentic conversation persists same-shaped docs (AD-12: `queries` per turn via the BFF,
   `conversations`/`messages`/`conversationFiles`/`queryMessages` on save; session state was
   in-request and is gone). The legacy path therefore needs no agent-specific state: the GET
   serves agentic metadata keys verbatim (unread extras), the render fields
   (`confidence_score`, `is_grounded`, `source_documents`) are the legacy fields, and a new turn
   answers through the legacy pipeline into the same-shaped `queries` doc with the
   `queryMessages` edge on save. The one real gap — snapshot rows dropping the okf-concept
   identity — is fixed at write time: rows for `source: 'okf-concept'` source documents now
   carry `source`, `concept_id`, `repo_id`, `bundle_version` (the exact snake_case names the
   frontend's `translateSources` reads), and the conversation read path projects them. Citations
   re-resolve after rollback through the existing conventions (ADR okf-006's 403/404 posture,
   okf-server's exact-join concept GET) — no new endpoint, no new fetch. Pre-existing rows stay
   as they are; the frontend's graft fallback (grafting identity from the raw
   `metadata.source_documents`) continues to heal them.

### Acceptance scenario — the story's contract

| Phase               | Action                                                                                                                         | Expected                                                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Create (flag on)    | An agentic conversation is created: a `queries` doc with agent metadata, a saved message citing an okf concept, snapshot rows. | Same-shaped docs; the snapshot rows carry the okf stable ids.                                                                                                                                          |
| Roll back           | The flag is turned off and the process restarts.                                                                               | The route resolves legacy; an in-flight stream on the old process completed on its resolved path only if it finished inside the shutdown window — otherwise it ended unanswered, per the policy above. |
| Restore (flag off)  | The conversation is loaded through the legacy read path.                                                                       | History renders (`grounding_status`/`agent_run` ride verbatim, unread); the sidebar resolves the concept as okf-concept (type MD, empty url, okf open/download flows); no dead doc-repo URL.           |
| Continue (flag off) | A new turn is asked.                                                                                                           | The legacy pipeline answers into the same-shaped `queries` doc; the `queryMessages` edge links on save.                                                                                                |

## Alternatives considered

| Alternative                                                          | Verdict      | Why                                                                                                                                                                                                                    |
| -------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-request flag re-read (hot switch mid-stream)                     | **Rejected** | A stream re-routed mid-answer would mix two pipelines in one transcript; the single-read invariant is what makes the route deterministic per request (AD-9, story 3.1's pinned tests).                                 |
| A client-facing terminal marker on `done`/`metadata`                 | **Rejected** | The marker's home is the persisted metadata; it reaches the stream only incidentally, as an additive key on one anomaly path (§2). A terminal-frame marker would make the client contract carry a persistence concern. |
| Partial saves drop the text and leave the doc unanswered             | **Rejected** | Destroys the partial answer the user actually saw; "handled honestly" means the persisted record matches what happened, not that it is erased.                                                                         |
| Backfill okf identity onto pre-existing snapshot rows                | **Rejected** | A migration over user-owned history (AD-12 forbids it); the frontend graft already heals those rows from the raw metadata.                                                                                             |
| A per-conversation routing marker so history "knows" its origin path | **Rejected** | Rollback continuity is a data-shape property; a marker would give the legacy path agent-specific state to require — the exact failure AD-12 exists to prevent.                                                         |

## Consequences

- **Positive**: rollback is a restart with a defined in-flight story; every persisted partial is
  distinguishable from a completion; a run that streamed nothing never fakes an answer; agentic
  turns count correctly in abstention analytics; restored conversations re-resolve okf
  citations end-to-end (sidebar included) with zero migration; the legacy path stays
  byte-identical beyond the shared marker on the anomaly path (D02 regression pin).
- **Negative**: an interrupted answer persists marked but still `isAnswered: true` — consumers
  that want "the model finished" must read the marker. Accepted: the marker is additive and the
  alternative (a third terminal state) would change the shared finalize every consumer reads.
- **Known limitation**: an agentic finalize persists `okfRoutedGraphs: []` — the agentic
  citation rows do not carry `graph_name`, so the sticky-graph derivation reads an empty set.
  Self-healing: the next legacy turn in the session re-derives and re-persists the set from its
  own answer. Story 2.11's surface (version-record persistence for timed-out or crashed runs)
  remains backlog; this record only guarantees the states that already exist are honest.
- **Reconsideration triggers**: a deployment needing mid-stream re-routing (would reopen AD-9);
  a client contract that must surface interruption state in the stream (would reopen the AD-8
  event list); a per-user/tenant activation granularity (the iteration-2 evolution already
  named in the spine).

## References

- PRD `agentic-foundations` FR-16; architecture spine AD-9, AD-11, AD-12.
- Story 3.1's routing suite (`__tests__/services/query-service.test.js`, the flag-off/on pins).
- The disconnect partial-save pins: `__tests__/routes/agent-frame-writer.test.js` and
  `__tests__/routes/query-routes.test.js` (story 3.2).
- ADR agentic-001 (retained-answer visibility — the re-resolution posture this record rides).
- ADR okf-006 (the 403/404 posture of the re-resolution reads).
