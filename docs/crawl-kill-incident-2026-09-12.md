# Crawl Kill Zombie Incident — 2026-09-12 (local build)

## Symptom

After killing a large zalora.co.id site crawl from the UI, new crawl jobs
(Bali Wikipedia page, gilibestdeal.com, others) stayed `Pending` and never
started. The crawl worker heartbeat (5s DB poll) kept running.

## Root cause (log-proven timeline, all UTC)

The kill signal lives **only in the `crawl_job` document** (`kill_requested`
flag). Two defects interacted:

1. **`deleteFile` had no active-crawl guard** — it removed the `crawl_job`
   doc unconditionally ([fileService.js](../components/document-repository/src/services/fileService.js)).
   The user killed at 03:19:15, deleted the file at ~03:19:22 — 7 seconds
   later the kill channel did not exist.
2. **`checkKillStatus` failed OPEN on the deleted doc**: reading the job doc
   throws `document not found`; the catch treated it as a transient DB error
   ("rely on next check") and the crawl continued. Result: the crawl ran
   unkillable for ~33 more minutes (03:19→03:52), then exited only because it
   hit `maxDepth` on its own ("Crawl finished. Reached max depth 4").
3. **Latency defect (secondary)**: `checkKillStatus` only runs from crawl
   callbacks (per fetched page / per batch). With 20 parallel URLs deep in
   5-attempt×5s-timeout retry storms, observed kill-check cadence was ~15s —
   and unbounded in pathological cases.
4. **Swallowed kill sentinel (latent bug found during the fix)**: the batch
   loop matched `err.message.includes('killed')` (lowercase) while the worker
   throws `'Killed'` — a kill signal arriving as a rejected batch task was
   silently swallowed and the crawl continued to the next batch.

Because the worker is single-flight (picks exactly one `Pending` job and does
not poll again until the job finishes), the zombie crawl held the queue: jobs
scheduled at 03:20:48 (gilibestdeal) and 03:23:04 (Bali) sat `Pending` until
the zombie died at 03:52. No data was lost — the queued jobs were deleted by
the user while stuck.

## Fixes (this branch)

- **Kill-watch timer** ([crawlWorker.js](../components/document-repository/src/workers/crawlWorker.js)):
  a 2s `setInterval` polls the job doc independent of crawl callbacks; on
  `kill_requested` (or a deleted job doc) it flips the kill flag and calls
  `crawler.abort()`. Kill latency is now ≤2s regardless of retry storms.
- **Fail-closed on deleted job doc**: `checkKillStatus` treats definitive
  not-found (arangojs `statusCode 404` / `errorNum 1202` / "document not
  found") as `Killed` instead of a transient error. Transient DB errors still
  fail open.
- **Hard abort in Crawler** ([crawler.js](../components/document-repository/src/utils/crawler.js)):
  `abort()` flips `isAborted` and aborts the `AbortController` whose signal is
  passed to every axios request; checks between fetch attempts, in
  `processWork`, in the seed/batch loops unwind the crawl immediately. Also
  fixed the lowercase-only `includes('killed')` match bug (now `/killed/i`).
- **Server-enforced kill-before-delete** ([fileService.js](../components/document-repository/src/services/fileService.js)):
  `deleteFile` now calls `_terminateActiveCrawl`: a `Crawling` job gets
  `kill_requested` + a confirmation wait (poll until the job leaves
  'Crawling', 30s cap → HTTP 409 "still stopping" for retry); a `Pending`
  job is removed directly so the worker never starts it for a deleted file.
- **Controller**: delete maps "still stopping" to **409** so the client can
  retry (file untouched).

## Verification

- Jest: 451/456 pass; the 5 failures in `security.test.js` are pre-existing
  and environmental (Jest ESM: "A dynamic import callback was invoked without
  --experimental-vm-modules" from the ESM-only `file-type` dependency) —
  unrelated to this change (suite and code untouched by it).
- Live smoke on the local build (fixed image verified by in-container grep of
  the `killWatch` marker), success criteria and measured results:

  | Criterion | Measured |
  |---|---|
  | Kill a running crawl from the API (UI button calls the same endpoint) | `Killed` recorded **2s** after the kill call (log: kill 05:17:14 → "Crawl failed: Killed" 05:17:16; job doc `status: Killed`, `error_message: Killed`) |
  | Delete a file **during** an active crawl (the incident scenario) | HTTP 200 in **2.1s**; log shows `_terminateActiveCrawl` sent the kill, crawl dead 2s later, `crawl_job` doc removed — no zombie |
  | Queued jobs launch after kill/delete | next pending job picked up within one poll tick and succeeded |
  | No fail-open regression | zero `Kill check failed: document not found` lines after the fix (previously one every ~15s during the zombie window) |
