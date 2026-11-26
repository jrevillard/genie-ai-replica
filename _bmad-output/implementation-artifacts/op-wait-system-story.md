# Story — #2195: global operation-wait system (fence-clean build)

**Status:** IN PROGRESS (2026-11-26)
**Issue:** #2195 (`perf(okf-frontend)` → `feat`, priority::high, admin-ux)
**Branch:** `feat/okf-op-wait-system` (off main `798a5ccaf`, the 3.1.0 release commit)
**Worktree:** `D:\ITU-Gitlab\.claude\worktrees\okf-op-wait`

## Intent (David, 2026-11-26)

During a curation session on a 10k-concept repo the UI repeatedly locks with no
app-level affordance — the browser's native busy state does work the app should
do. `httpService` has no loading layer; the only in-app feedback (ConceptList's
`Loading files {done}/{total}` bar) needs the very main thread the work
saturates, so it renders late or never.

**Law:** any Studio operation that can exceed ~1 s must register with the
operation-wait system. No browser-native wait states in the Studio, ever.

## Rulings recorded before commencement

1. **One MR per issue** (10-MR plan, autonomous merge for routine MRs; #2195
   and #2196 stop for David's click).
2. **Scope fence, sharpened mid-commencement** (David: "stop and ask before
   making any changes outside the scope of the admin dashboard"): the OKF
   Studio is a tab of AdminDashboard (`AdminDashboard.vue:1813` mounts
   `okf/StudioTab.vue`), so Studio surfaces are in-fence. **Fence-clean build
   CONFIRMED by David (multi-choice, 2026-11-26):** `httpService.js` stays
   UNTOUCHED; the overlay mounts inside `AdminDashboard.vue`; operations
   register explicitly. #2194's re-auth surfacing becomes a separate flagged
   ask when that issue starts.

## Design (fence-clean)

- `src/services/operationWaitService.js` (NEW, in-fence: a service consumed by
  the dashboard tab) — named operations; progress `0-1` or `{done,total}`;
  min-visible duration; cancellation; subscribe API for the overlay.
  Reactive-light by design: the overlay renders off the data path the
  operation feeds (its own small reactive store, never the operation's
  payload arrays).
- `src/components/admin/OperationWaitOverlay.vue` (NEW) — mounted in
  `AdminDashboard.vue`; DsModal/Ds primitives + tokens only (UI-must-use-DS
  rule); shows the active operation(s), progress, cancel affordance.
- Registrations begin with the six measured waits + the rest of the issue's
  list, all inside okf surfaces: concept-list page fetch (#2188 wires deeper
  progress later), links fetch, repos-list load, grant/revoke waves, PII
  scans, conformance/validation passes, topic-link runs, RAGAS generation,
  and the studio-side session re-auth notice (the refresh call itself stays
  in the session layer — #2194 owns moving it; this MR only surfaces the
  state the studio already knows about).
- httpService is NOT modified. Non-Studio surfaces (chat, analytics, crawler)
  are out of scope for this MR by ruling.

## Acceptance (from the issue, fence-clean mapping)

- The six documented waits replay with a visible, cancellable app state each.
- Overlay survives main-thread pressure (decoupled render path) — proven by a
  test that saturates the main thread with a large array commit while the
  overlay state updates independently.
- No browser-native busy state for any registered operation.

## Verification plan

- TDD: service contract (register/progress/complete/cancel/min-visible/
  concurrent ops) RED→GREEN; overlay render test (visible on register, gone
  on complete, cancel fires); saturation test.
- Full frontend suite green; coverage ≥ current main baselines (checked at
  branch point); prettier + eslint clean; npm audit on the component.
- Deploy to the local build BEFORE merge (ruled thrice) + live replay of the
  waits; then /security-review on the full diff + /code-review high → fixes →
  /simplify → verification-before-completion. MR ready-block to David — HIS
  merge click (priority::high feat story, ruled).
