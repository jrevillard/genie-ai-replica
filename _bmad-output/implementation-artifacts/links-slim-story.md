# Story — #2190: slim + ETag the links endpoint (1.6 MB unpaginated)

**Status:** IN PROGRESS (2026-11-26)
**Issue:** #2190 (`perf(okf-server)`)
**Branch:** `feat/okf-links-slim` (off main `c133d66de`)
**Worktree:** `D:\ITU-Gitlab\.claude\worktrees\okf-links-slim`

## Intent (David, 2026-11-26)

`GET /okf/repos/:id/links` returned **1,655,486 bytes** on every editor/graph
mount — Kong logged `an upstream response is buffered to a temporary file`
on each fetch, and the fetch repeated after every silent re-auth.

## Design

- `?summary=1` — a count-only mode: one AQL pass computes
  `{concept_count, link_count}`; no edges leave the server. For panels and
  badges that never needed the graph.
- `limit`/`offset` — edge pagination on the flattened list, `link_count`
  carrying the FULL count (a paged consumer knows the size).
- Default unchanged — the full graph, byte-identical shape (acceptance:
  RepoGraphView behavior unchanged).
- **ETag**: no code — Express's default weak-ETag 304s the deterministic
  body (the same mechanism behind the measured concepts-route 304s);
  verified `etag` is never disabled in the app setup.
- The Kong `proxy_buffers` change ships with the instance-sizing guide
  (#2197), per this issue's own text ("config ships with the deploy issue").

## Verification

- TDD RED→GREEN: route tests pin the param pass-through (summary/limit/
  offset as numbers, default unchanged); service tests pin counts-only (the
  count query fetches NO link bodies), full-shape compat, pagination with
  honest totals, and past-end emptiness. 2611/2611; coverage
  88.63/75.91/89.67/90.12 — above baseline on all four.
- Deploy to the local build before merge; the acceptance metric is the
  response size with `?summary=1` and the absence of the Kong temp-file warn
  on a default mount.
