# Branch reconciliation — `release/el-salvador` (2026-10-13)

Records how `release/el-salvador` was reconciled after diverging from `main` in
two directions, and why the eight stale mobile MRs were closed rather than
merged. Companion to MR **!540**.

## The situation

Two independent things happened to the branch at once:

1. `main` moved on — it was rebased forward to `b327b8ab0` (+258 commits:
   BMAD tooling restructure, live-validated retriever `K=32` T13b champion,
   `dataprep_chunk_size_md` 1400 per !397, fluentd buffering + canonical OTel
   `service.name` labelling, `winston-transport` dependency).
2. The local branch still held **the build that was tested on the emulator and
   the phone** — the one wired to `https://mvp.ai.assembly.govstack.global`,
   AgroGenio-branded, with sign-in verified end to end.

Neither side was ahead in a simple sense: `origin/release/el-salvador` had 258
commits the local branch lacked, and the local branch had 165 commits origin
lacked.

## Why the MRs were not merged

Eight of your MRs targeted `release/el-salvador`, all conflicted:

| MR | Scope | Disposition |
|---|---|---|
| !410 | backend null-guard on partial updates | **ported forward** |
| !422 | quick-help label parity | already in the tested build |
| !424 | mobile bug backlog / work plan | **ported forward** |
| !427 | M25 auth session recovery | **ported forward** |
| !436 | Quick Help filter chip (M28) | in the tested build, **with a newer fix** (!449) |
| !437 | ungrounded-answer label (M30) | already in the tested build |
| !438 | reset filter after non-streaming send (M31) | already in the tested build |
| !450 | patrol/R8/ApiService retry (APK unblock) | already in the tested build |

An audit (`git cherry` + content diffs) showed **6 of the 8 were already present**
in the tested build. Several MR branches were forked weeks earlier and still
carried *older* versions of files the tested build had since fixed — for example
the raw `tr('chatbot.welcomeMessage')` key and the pre-!449 single-source chip
clear. Merging those branches wholesale would have **regressed** the tested
code.

Three items, however, existed in **no branch at all** — not local, not origin,
not `main` — and were genuinely at risk of being lost. Each was cherry-picked
forward with `-x` provenance.

## What was done

**Merge** (`c00877052`) — origin merged into the tested branch. Five conflicts,
all resolved toward origin's newer work, with el-salvador identity verified
intact afterwards (`nginx_public_domain`, `keycloak_theme`,
`kc_mobile_client_id`/`kc_mobile_redirect_scheme`, `reranking_strategy`).

The merge silently deleted two auth test files (`app_auth_test.dart`,
`connectivity_checker_test.dart`) that exist in the tested build — git took
origin's deletion. **Reverted.** After that the mobile tree was byte-identical
to the tested commit `6f9214a65`.

**Ported forward:**

- `e07460271` — !410, conversation/folder null-guard
- `13dc49a0c` — !427, M25 auth session recovery. The only conflict resolved in
  favour of the branch: it keeps the **refined** `transientFailure` handling
  already in the tested build and takes the MR's new 401-without-token recovery.
- `a3676eb4a`, `7a2f1b823`, `93de16c58` — !424, the work plan docs

## Verification

- Mobile tree byte-identical to `6f9214a65` before gap-porting; the
  `tr('welcomeMessage')` fix and !449's both-sources chip clear preserved.
- `flutter analyze` clean; **563 mobile tests pass** (559 + 4 from M25).
- **1927 backend tests pass.** Three failures are Windows-only and in files this
  work never touches: `path-sanitizer` asserts Unix path semantics, and
  `analytics-service` expects `21:30` while the host locale renders `21.30`.
  Both pass in CI's Linux container.
- No dangling imports from `main`'s 49 file removals.
- APK built from this exact tree; sha256 matched byte-for-byte on the emulator,
  which signed in successfully against mvp.ai and returned live data
  (Crop Health 77 Good, Pest Alerts 2 Active).
- The push is a **clean fast-forward** — origin's tip is a direct ancestor, no
  history rewrite.

## Note on process

`release/el-salvador` is a protected branch; direct pushes are rejected by the
pre-receive hook. This went through MR !540, per the branch-process rule that
`release/*` is only ever updated via a merge request.

## Recovery

The pre-reconciliation tested build is preserved as
`backup/pre-reconcile-tested-6f9214a65` (`6f9214a65`).