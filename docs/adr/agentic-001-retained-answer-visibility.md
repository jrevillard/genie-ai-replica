# ADR agentic-001: Earlier answers stay visible after their source is revoked

- **Status**: Proposed
- **Date**: 2026-11-20
- **Decision owners**: GENIE.AI engineering (operator accepts at merge)
- **Binds**: FR-28 (retained data), PRD §4.1 persistence scope, spine AD-4 (executor enforcement), AD-12 (no new persistence)
- **Story**: [#1953](https://opensource.unicc.org/un/itu/genie-ai/-/issues/1953) — story 1.7, "Implement `read_source` and the authorization executor"

## FR-29 traceability

```
use case (a user keeps the conversation that cited a source later revoked)
  -> requirement (FR-28: retained data has ownership and access rules; the post-revocation
     visibility of earlier answers is an explicit product-policy decision — recorded, not defaulted)
    -> decision (this record: stored answers stay; re-resolution goes through the existing serving reads)
      -> investigation (V04 map §4 — ownership of retained data; the executor's per-request re-validation, story 1.7)
        -> merge request (the story 1.7 MR)
          -> validation evidence (the FR-28 tests: a permission change between turns invalidates retained-evidence reuse)
            -> released version (the merge into feat/agentic-foundations/prd)
```

## Context

A governed document-QA answer cites sources. Sources can be revoked afterwards: a repository is
restricted or retracted, a concept stops serving, a file is deleted. The question FR-28 hands to
this story: **what does the user still see of an earlier answer whose source is now revoked?**

The V04 map (§4) records the ownership facts this decision must respect:

- Conversations are edge-owned (`userConversations`, `role: "owner"`); messages inherit through
  the conversation; query records carry `userId`. The citation snapshot rows (`conversationFiles`)
  carry no owner — they are reachable by anyone who can reach the conversation.
- There is **no sweeping authority** today: nothing retroactively edits stored answers, and the
  stores that hold them are the product's user-owned history.

### Constraints

- No new governance or persistence layer (AD-12, NFR-7): the decision must be executable with
  the existing stores and the existing authorities.
- Rollback continuity (FR-16): a conversation created on the agentic path must read identically
  on the legacy path — the decision cannot stamp agent-specific state into history.
- No restricted content may become readable *because* it was stored: the fence's reach must not
  shrink for stored data.
- The agent must not reuse retained evidence across a permission change (FR-28, tested in
  story 1.7).

## Decision

**Stored answers stay visible; re-resolution is what is governed.**

1. The answer text and its citation rows persist in the existing shapes
   (`conversations` / `messages` / `queries` / the metadata frame's `source_documents`) and are
   never retroactively edited or deleted when a source is revoked.
2. When a retained citation is **re-resolved** — the citation card opens, a restored conversation
   re-renders — it goes through the **existing serving reads** (doc-repo's metadata and serve
   paths, okf-server's exact-join concept GET). Those reads refuse a revoked, fenced or absent
   source at view time (404 collapsed for foreign and fenced — anti-enumeration), and the card
   reports the source as unavailable. Nothing serves restricted content because it was once cited.
3. Retained **evidence reuse** by the agent is governed per request: the authorization executor
   (story 1.7) re-validates every target and every search hit against the context handed in THAT
   request, so a follow-up turn whose authorized set no longer includes the source is refused —
   the permission change between turns invalidates the reuse, and a test pins it.

### Acceptance scenario — save / revoke / restore

| Phase | Action | Expected |
|---|---|---|
| Save | The user saves a conversation whose answer cites source S (a legacy file or an OKF concept). | The citation row persists in the existing shapes; nothing agent-specific is stamped. |
| Revoke | Source S is revoked (repo restricted or retracted, concept no longer serving, file deleted). | The stored answer text stays exactly as delivered; no sweeper edits history. |
| Restore | The conversation is restored and opened on either path; the user clicks the citation; the user asks a follow-up. | The answer text renders as stored. Re-resolving the citation goes through the existing serving reads and reports the source unavailable. The follow-up's fresh authorized set no longer reaches S; the executor refuses any read of it. |

## Alternatives considered

| Alternative | Verdict | Why |
|---|---|---|
| Redact or scrub stored answers on revoke | **Rejected** | Mutates user-owned history; requires a sweeping authority that does not exist and would be a new governance layer (AD-12). |
| Hide the whole earlier answer once its source is revoked | **Rejected** | Destroys the record of what the user was legitimately told; the revocation governs future access, not the past conversation. |
| Snapshot the cited content into the citation row so it stays readable after revoke | **Rejected** | Copies content into a store the fence does not cover (`conversationFiles` carries no owner — V04 §4); the restricted corpus would leak through history. |

## Consequences

- **Positive**: no new store, no new governance layer; rollback continuity holds (history reads
  identically on both paths); the user sees their own history; the citation surface is honest
  (unavailable, not silently missing); the agent path stays fail-closed on reuse.
- **Negative**: a user whose source was revoked still reads the answer they were given earlier.
  Accepted: the revocation controls *future* retrieval and *re*-resolution, not the historical
  text the user already received. Operators needing retroactive erasure (a compliance regime)
  have the conversation-removal controls of the existing stores.
- **Reconsideration triggers**: a compliance requirement for retroactive erasure of answers; a
  per-user ACL appearing on the legacy corpus (changes the executor's mapping and this record's
  reuse paragraph together); the V04 record's trigger row.

## References

- PRD `agentic-foundations` FR-28; architecture spine AD-4, AD-12; the V04 map §4.
- Story 1.7's FR-28 tests (`components/agent-service/tests/test_executor.py`).
- ADR okf-006 (the 403/404 posture the re-resolution path rides).
