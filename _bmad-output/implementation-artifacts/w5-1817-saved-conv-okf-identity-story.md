# W5 follow-up — saved conversations keep their OKF citations (#1817)

**Status:** IMPLEMENTED 2026-11-13 — MR **!872** (`fix/issue-1817-saved-conv-okf-identity`
→ `main`), deployed to the local build pre-merge.
**Issue:** **#1817** (filed by David mid-wave: "when a user saves conversations that
accessed OKF repositories and reloads them, the OKF repository and file details are
lost").

## Rulings (David, this session)

1. **Repro first, then decide** — done: the live repro drove a fresh OKF-citing
   chat, completed the two-step save, and read both the Vuex state and the
   persisted rows.
2. **Repair old conversations at restore** — the pre-CAP-1 rows (concept_id +
   graph_name, no repo_id) resolve LIVE through the new okf-server resolver; a
   definitive null settles the row with the honest terminal marker.
3. **All three restore modes** — card open/download, reference-file link
   (okfSources), repo browse navigation.
4. **"Don't fuck up the legacy document path mappings"** — the backend
   conversationFiles write/read is UNTOUCHED; the okf rows heal client-side from
   the message metadata.

## What the repro established

- The SAVE is healthy: the persisted assistant row carries `metadata.source_documents`
  with the full CAP-1 identity (`source: okf-concept`, `repo_id`, `graph_name`,
  `concept_id`). An earlier "only the user turn persisted" reading was a mid-stream
  save (before the done frame the streamed answer has no queryId yet) — the realistic
  post-done save persists both turns.
- The RESTORE discarded both halves: `loadExistingConversation` rebuilt messages
  WITHOUT sources, and the sidebar from the identity-less conversationFiles snapshot
  → dead `/api/files/...` links. `graftOkfIdentityOntoRestored` only ran in the
  sessionStorage path, never on the server-loaded path.

## The fix

- `loadExistingConversation` rebuilds each message's sources from
  `msg.metadata.source_documents` (translateSources over the raw rows).
- Store action **`repairRestoredOkfIdentity`** (run after both the server load and
  the sessionStorage rehydrate): graft → live legacy resolution → title +
  `okfSources` fetched through the shared title cache and patched onto EVERY
  message (the old `patchSource` reaches only the last).
- okf-server: **`GET /api/okf/concepts/resolve-repo?concept_id=X`** +
  `listReposForConcept` — getConcept's serving gates applied PER CANDIDATE
  (readAuthzForService, the 6-1c restricted fence, the publication gate, meta-row
  existence); a restricted twin never hides a visible holder; no survivor answers
  the anti-enumeration 404.

## Verification

- okf-server: controller-surface 83/83 (9 new resolver gate cases), concept-meta
  86/86 (3 new `listReposForConcept` cases). Full suite 2259/2259.
- frontend: conversation store 53/53 (6 new repair cases), ChatBotComponent
  252/252 (2 new restore cases). Full suite 4493/4493.
- Coverage: frontend 89.58% statements, okf-server 87.69% (thresholds held+raised).
- Live (deployed `issue-1817` images, marker-verified): storage→reload→store
  timeline intact (sources survive the rehydrate); injected-payload reload shows
  the repair running live (`titleResolved: true`, identity grafted, sidebar healed).
  One earlier probe run failed amid the stack's Docker churn; two clean passes on
  the settled stack supersede it.
- Prettier + ESLint clean on every changed file.
